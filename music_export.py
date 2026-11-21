"""Bounded audio export jobs, prepared server-side and delivered by Telegram."""
import json,time,secrets,threading,tempfile,subprocess,os,shutil,mimetypes
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler,urlopen
from urllib.parse import urlsplit

LOCK=threading.Lock();STARTED=False
CAPTION='🎧 Сохрани аудио в Telegram для прослушивания офлайн.\nДля музыки в профиле открой трек и выбери «Добавить в профиль».\n\n<b><a href="https://t.me/TelefyApp_Bot">Трек выгружен с помощью Telefy</a></b>'

def markup():return {'inline_keyboard':[[{'text':'В профиль','style':'success','callback_data':'export_profile_help'}]]}

def store():
 import bot_reminders as rem
 root=rem.store();root.ensure();db=root.db
 with LOCK:
  if not getattr(db,'export_store',None):db.export_store=ExportStore(db)
 s=db.export_store;s.ensure();return s

class ExportStore:
 def __init__(self,db):self.db=db;self.lock=threading.Lock();self.ready=False
 def ensure(self):
  with self.lock:
   if self.ready:return
   with self.db.connect()as c:
    if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620116)')
    self.db.execute(c,'''CREATE TABLE IF NOT EXISTS telefy_audio_exports(id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,urn TEXT NOT NULL,status TEXT NOT NULL,created_at BIGINT NOT NULL,started_at BIGINT NOT NULL,message_id BIGINT NOT NULL,error TEXT NOT NULL)''')
    self.db.execute(c,'''CREATE TABLE IF NOT EXISTS telefy_audio_files(urn TEXT PRIMARY KEY,file_id TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,duration INTEGER NOT NULL)''')
   self.ready=True
 def enqueue(self,uid,urn):
  import re
  if not isinstance(urn,str)or not re.fullmatch(r'soundcloud:tracks:[0-9]{1,22}',urn):raise ValueError('invalid_track')
  now=int(time.time())
  import max_billing
  from daily_usage import day_window,EXPORTS
  unlimited=max_billing.STORE.status(uid)['active']
  _,start,end=day_window(now)
  with self.db.connect()as c:
   if self.db.url:self.db.execute(c,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s FOR UPDATE',(uid,))
   row=self.db.execute(c,"SELECT * FROM telefy_audio_exports WHERE telegram_id=%s AND urn=%s AND status IN ('queued','preparing','sending') ORDER BY created_at DESC LIMIT 1",(uid,urn)).fetchone()
   if row:return dict(row)
   if not unlimited:
    used=self.db.execute(c,"SELECT COUNT(*) AS n FROM telefy_audio_exports WHERE telegram_id=%s AND created_at>=%s AND created_at<%s AND status!='failed'",(uid,start,end)).fetchone()['n']
    if used>=EXPORTS:raise ValueError('export_limit')
   count=self.db.execute(c,"SELECT COUNT(*) AS n FROM telefy_audio_exports WHERE status IN ('queued','preparing','sending')").fetchone()['n']
   if count>=30:raise ValueError('queue_busy')
   pid=secrets.token_hex(12);self.db.execute(c,'INSERT INTO telefy_audio_exports VALUES(%s,%s,%s,%s,%s,0,0,%s)',(pid,uid,urn,'queued',now,''))
  return self.get(uid,pid)
 def get(self,uid,pid):
  with self.db.connect()as c:r=self.db.execute(c,'SELECT * FROM telefy_audio_exports WHERE id=%s AND telegram_id=%s',(pid,uid)).fetchone()
  return dict(r)if r else None
 def cached(self,urn):
  with self.db.connect()as c:r=self.db.execute(c,'SELECT * FROM telefy_audio_files WHERE urn=%s',(urn,)).fetchone()
  return dict(r)if r else None
 def claim(self):
  now=int(time.time())
  with self.db.connect()as c:
   if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620118)')
   # Preparation is safe to repeat after a crash; an ambiguous upload is not.
   self.db.execute(c,"UPDATE telefy_audio_exports SET status='queued' WHERE status='preparing' AND started_at<%s",(now-600,))
   self.db.execute(c,"UPDATE telefy_audio_exports SET status='uncertain',error='delivery_uncertain' WHERE status='sending' AND started_at<%s",(now-600,))
   if self.db.execute(c,"SELECT COUNT(*) AS n FROM telefy_audio_exports WHERE status IN ('preparing','sending')").fetchone()['n']:return None
   r=self.db.execute(c,"SELECT * FROM telefy_audio_exports WHERE status='queued' ORDER BY created_at LIMIT 1"+(' FOR UPDATE SKIP LOCKED'if self.db.url else '')).fetchone()
   if not r:return None
   changed=self.db.execute(c,"UPDATE telefy_audio_exports SET status='preparing',started_at=%s WHERE id=%s AND status='queued'",(now,r['id']))
   return dict(r)if changed.rowcount==1 else None
 def finish(self,job,status,error='',message_id=0):
  with self.db.connect()as c:self.db.execute(c,'UPDATE telefy_audio_exports SET status=%s,error=%s,message_id=%s,started_at=%s WHERE id=%s',(status,error,message_id,int(time.time()),job['id']))
 def remember(self,urn,result,track):
  audio=result.get('audio')or{}
  if not audio.get('file_id'):return
  with self.db.connect()as c:self.db.execute(c,'INSERT INTO telefy_audio_files VALUES(%s,%s,%s,%s,%s) ON CONFLICT(urn) DO UPDATE SET file_id=excluded.file_id,title=excluded.title,artist=excluded.artist,duration=excluded.duration',(urn,audio['file_id'],track['title'],track['artist'],round(track['duration'])))

def safe_url(url):
 p=urlsplit(url);host=p.hostname or''
 if p.scheme!='https'or p.username or p.password or p.port not in(None,443)or not any(host.endswith(s)for s in('.sndcdn.com','.soundcloud.cloud','.cloudfront.net')):raise ValueError('unsafe_media_url')
 return url

class SafeRedirect(HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return super().redirect_request(req,fp,code,msg,headers,safe_url(newurl))

def prepare(track,url,directory):
 if not shutil.which('ffmpeg'):raise ValueError('encoder_unavailable')
 if not 0<float(track['duration'])<=1200:raise ValueError('track_too_long')
 directory=Path(directory);cover=None;thumb=None;image=track.get('coverImg')
 if image:
  try:
   with build_opener(SafeRedirect()).open(safe_url(image),timeout=15)as r:data=r.read(3*1024*1024+1)
   if len(data)>3*1024*1024:raise ValueError()
   original=directory/'cover.input';original.write_bytes(data);cover=directory/'cover.jpg'
   subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(original),'-vf','scale=600:600:force_original_aspect_ratio=decrease','-frames:v','1','-y',str(cover)],check=True,timeout=20,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   thumb=directory/'thumbnail.jpg'
   subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(cover),'-vf','scale=300:300:force_original_aspect_ratio=decrease','-q:v','5','-frames:v','1','-y',str(thumb)],check=True,timeout=15,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   if thumb.stat().st_size>190000:thumb=None
  except Exception:cover=None;thumb=None
 output=directory/'track.mp3'
 args=['ffmpeg','-nostdin','-v','error','-protocol_whitelist','https,http,tcp,tls,crypto','-rw_timeout','20000000','-i',safe_url(url)]
 if cover:args+=['-i',str(cover),'-map','0:a:0','-map','1:v:0','-c:v','mjpeg','-disposition:v','attached_pic']
 else:args+=['-map','0:a:0','-vn']
 args+=['-t',str(min(1205,float(track['duration'])+5)),'-c:a','libmp3lame','-b:a','128k','-id3v2_version','3','-metadata','title='+track['title'][:200],'-metadata','artist='+track['artist'][:200],'-fs','45000000','-y',str(output)]
 subprocess.run(args,check=True,timeout=240,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 if not output.exists()or not 1000<output.stat().st_size<45000000:raise ValueError('encode_failed')
 probe=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(output)],capture_output=True,text=True,check=True,timeout=10)
 if float(probe.stdout)<float(track['duration'])-4:raise ValueError('incomplete_audio')
 return output,thumb

def upload(uid,path,thumb,track):
 import telefy_bot as bot
 boundary='Telefy'+secrets.token_hex(16);parts=[]
 fields={'chat_id':str(uid),'title':track['title'][:200],'performer':track['artist'][:200],'duration':str(round(track['duration'])),'caption':CAPTION,'parse_mode':'HTML','reply_markup':json.dumps(markup(),ensure_ascii=False)}
 files={'audio':path}
 if thumb:files['thumbnail']=thumb
 for key,value in fields.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
 for key,file in files.items():
  filename='track.mp3'if key=='audio'else'thumbnail.jpg'
  parts+=[f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{filename}"\r\nContent-Type: {mimetypes.guess_type(filename)[0]}\r\n\r\n'.encode(),Path(file).read_bytes(),b'\r\n']
 body=b''.join(parts)+f'--{boundary}--\r\n'.encode()
 try:
  req=Request('https://api.telegram.org/bot'+bot.TOKEN+'/sendAudio',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
  with urlopen(req,timeout=90)as r:result=json.load(r)
 except Exception:raise bot.BotError('delivery_uncertain')from None
 if not result.get('ok'):raise bot.BotError('telegram_rejected',status=result.get('error_code'),definitive=True)
 return result['result']

def run_one():
 import telefy_bot as bot,bot_operations,profile_server
 if bot_operations.store().status()['maintenance']:return False
 s=store();job=s.claim()
 if not job:return False
 sending=False
 try:
  if not bot.subscribed(job['telegram_id']):raise ValueError('subscription_required')
  cached=s.cached(job['urn'])
  if cached:
   import content_policy
   if content_policy.blocked(cached):raise ValueError('content_blocked')
   track={'title':cached['title'],'artist':cached['artist'],'duration':cached['duration']};s.finish(job,'sending');sending=True
   try:result=bot.api('sendAudio',chat_id=job['telegram_id'],audio=cached['file_id'],title=track['title'],performer=track['artist'],caption=CAPTION,parse_mode='HTML',reply_markup=markup())
   except bot.BotError as error:
    if error.definitive and error.status==400:
     with s.db.connect()as c:s.db.execute(c,'DELETE FROM telefy_audio_files WHERE urn=%s',(job['urn'],))
    raise
  else:
   sc=profile_server.base.sc;data=sc.stream({'soundcloudUrn':job['urn']});track=data['track']
   with tempfile.TemporaryDirectory(prefix='telefy-export-')as tmp:
    audio,thumb=prepare(track,data['url'],tmp)
    if bot_operations.store().status(fresh=True)['maintenance']:raise ValueError('app_maintenance')
    if not bot.subscribed(job['telegram_id']):raise ValueError('subscription_required')
    s.finish(job,'sending');sending=True;result=upload(job['telegram_id'],audio,thumb,track)
   s.remember(job['urn'],result,track)
  s.finish(job,'sent',message_id=int(result.get('message_id',0)))
 except Exception as error:
  uncertain=sending and not(getattr(error,'definitive',False))
  code=str(error)if isinstance(error,ValueError)else getattr(error,'code','export_failed')
  if code not in('track_too_long','encoder_unavailable','subscription_required','app_maintenance','incomplete_audio','soundcloud_rate_limited'):code='delivery_uncertain'if uncertain else'export_failed'
  s.finish(job,'uncertain'if uncertain else'failed',error=code)
 return True

def start():
 global STARTED
 if STARTED:return
 STARTED=True
 def worker():
  while True:
   try:
    import telefy_bot as bot
    if bot.DIAGNOSTIC.get('state')=='ready'and run_one():continue
   except Exception:pass
   time.sleep(2)
 threading.Thread(target=worker,name='telefy-audio-export',daemon=True).start()

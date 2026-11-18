"""Account-level daily playback budget. Moscow midnight; idempotent heartbeats."""
import json,time,re,threading
from urllib.parse import urlsplit
from datetime import datetime,timezone,timedelta

LISTEN_MS=3600000
EXPORTS=10
LOCK=threading.RLock()

def day_window(now=None):
 now=time.time()if now is None else now
 dt=datetime.fromtimestamp(now,timezone(timedelta(hours=3)))
 start=int(dt.replace(hour=0,minute=0,second=0,microsecond=0).timestamp())
 return dt.date().isoformat(),start,start+86400

class UsageStore:
 def __init__(self,db):self.db=db;self.ready=False
 def ensure(self):
  with LOCK:
   if self.ready:return
   self.db.ensure()
   with self.db.connect()as c:
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_daily_usage(telegram_id BIGINT NOT NULL,day TEXT NOT NULL,listened_ms BIGINT NOT NULL,PRIMARY KEY(telegram_id,day))')
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_playback_sessions(telegram_id BIGINT NOT NULL,id TEXT NOT NULL,day TEXT NOT NULL,reported_ms BIGINT NOT NULL,updated_ms BIGINT NOT NULL,PRIMARY KEY(telegram_id,id))')
   import admin_analytics
   self.analytics=admin_analytics.Analytics(self.db);self.analytics.ensure()
   self.ready=True
 def report(self,uid,session=None,total=0,now=None):
  if session is not None and(not isinstance(session,str)or not re.fullmatch(r'[a-zA-Z0-9_-]{16,64}',session)or type(total)is not int or not 0<=total<=864000000):raise ValueError('invalid_usage')
  now=time.time()if now is None else now;day,start,reset=day_window(now);stamp=int(now*1000)
  self.ensure()
  import max_billing
  unlimited=max_billing.STORE.status(uid,now=int(now))['active']
  with LOCK,self.db.connect()as c:
   # Serialize different devices as well as duplicate requests on PostgreSQL.
   if self.db.url:self.db.execute(c,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s FOR UPDATE',(uid,))
   self.db.execute(c,'INSERT INTO telefy_daily_usage VALUES(%s,%s,0) ON CONFLICT(telegram_id,day) DO NOTHING',(uid,day))
   row=self.db.execute(c,'SELECT listened_ms FROM telefy_daily_usage WHERE telegram_id=%s AND day=%s',(uid,day)).fetchone();used=row['listened_ms']
   if session:
    old=self.db.execute(c,'SELECT * FROM telefy_playback_sessions WHERE telegram_id=%s AND id=%s',(uid,session)).fetchone()
    delta=0
    if old and old['day']==day:
     # A seek, stale retry, concurrent tabs or a fabricated giant report cannot
     # charge more than elapsed real time. Never trust a media position.
     delta=max(0,min(total-old['reported_ms'],stamp-old['updated_ms']+500))
    elif old:
     delta=max(0,min(total-old['reported_ms'],stamp-start*1000))
    self.analytics.playback(c,uid,day,delta)
    if not unlimited:used=min(LISTEN_MS,used+delta)
    # Stale/out-of-order reports must not move the checkpoint backwards.
    if not old or total>=old['reported_ms']:
     self.db.execute(c,'INSERT INTO telefy_playback_sessions VALUES(%s,%s,%s,%s,%s) ON CONFLICT(telegram_id,id) DO UPDATE SET day=excluded.day,reported_ms=excluded.reported_ms,updated_ms=excluded.updated_ms',(uid,session,day,total,stamp))
    self.db.execute(c,'UPDATE telefy_daily_usage SET listened_ms=%s WHERE telegram_id=%s AND day=%s',(used,uid,day))
    self.db.execute(c,'DELETE FROM telefy_playback_sessions WHERE telegram_id=%s AND updated_ms<%s',(uid,stamp-3*86400000))
  return {'day':day,'resets_at':reset,'server_time':now,'unlimited':unlimited,'listened_ms':used,'remaining_ms':max(0,LISTEN_MS-used),'limit_ms':LISTEN_MS,'export_limit':EXPORTS}

def store():
 import profile_server
 db=profile_server.DB
 with LOCK:
  if not getattr(db,'usage_store',None):db.usage_store=UsageStore(db)
 return db.usage_store

class UsageMixin:
 def do_GET(self):
  if urlsplit(self.path).path!='/api/me/usage':return super().do_GET()
  try:
   user=self.bot_user()
   if user:self.reply(200,store().report(user['telegram_id']))
  except Exception:self.reply(503,{'error':'usage_unavailable'})
 def do_POST(self):
  path=urlsplit(self.path).path
  if path=='/api/me/analytics':
   import admin_analytics
   return admin_analytics.route(self)
  if path not in('/api/me/usage','/api/soundcloud/stream'):return super().do_POST()
  if not self.same_origin():self.reply(403,{'error':'origin_rejected'});return
  try:
   user=self.bot_user()
   if not user:return
   if path=='/api/soundcloud/stream':
    result=store().report(user['telegram_id'])
    if not result['unlimited']and not result['remaining_ms']:self.reply(403,{'error':'listening_limit',**result});return
    return super().do_POST()
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=1024 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
   data=json.loads(self.rfile.read(n))
   self.reply(200,store().report(user['telegram_id'],data['session'],data['total_ms']))
  except (ValueError,TypeError,KeyError):self.reply(400,{'error':'invalid_usage'})
  except Exception:self.reply(503,{'error':'usage_unavailable'})

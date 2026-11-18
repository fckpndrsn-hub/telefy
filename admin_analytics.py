"""Prospective aggregate analytics. Independent of Max/free listening budgets."""
import time,re,threading,json,csv,io,secrets
from datetime import datetime,timezone,timedelta
LOCK=threading.RLock();TZ=timezone(timedelta(hours=3))
def day(at=None):return datetime.fromtimestamp(time.time()if at is None else at,TZ).date().isoformat()
class Analytics:
 def __init__(self,db):self.db=db;self.ready=False
 def ensure(self):
  with LOCK:
   if self.ready:return
   self.db.ensure()
   with self.db.connect()as c:
    for sql in [
     'CREATE TABLE IF NOT EXISTS telefy_analytics_meta(id INTEGER PRIMARY KEY,started_at BIGINT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_acquisition(telegram_id BIGINT PRIMARY KEY,source TEXT NOT NULL,first_seen BIGINT NOT NULL,first_open BIGINT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_analytics_daily(telegram_id BIGINT NOT NULL REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,day TEXT NOT NULL,listened_ms BIGINT NOT NULL DEFAULT 0,opens INTEGER NOT NULL DEFAULT 0,likes INTEGER NOT NULL DEFAULT 0,playlists INTEGER NOT NULL DEFAULT 0,exports INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(telegram_id,day))',
     'CREATE TABLE IF NOT EXISTS telefy_analytics_events(telegram_id BIGINT NOT NULL REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,event_id TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(telegram_id,event_id))']:
     self.db.execute(c,sql)
    self.db.execute(c,'INSERT INTO telefy_analytics_meta VALUES(1,%s) ON CONFLICT(id) DO NOTHING',(int(time.time()),))
   self.ready=True
 def acquire(self,uid,source='',opened=False,now=None):
  self.ensure();now=int(time.time())if now is None else int(now)
  source=source if re.fullmatch(r'ad_[A-Za-z0-9_-]{1,60}',str(source))else'direct'
  with LOCK,self.db.connect()as c:
   start=self.db.execute(c,'SELECT started_at FROM telefy_analytics_meta WHERE id=1').fetchone()['started_at']
   profile=self.db.execute(c,'SELECT created_at FROM telefy_users WHERE telegram_id=%s',(uid,)).fetchone()
   if profile and profile['created_at']<start:source='existing'
   self.db.execute(c,'INSERT INTO telefy_acquisition VALUES(%s,%s,%s,%s) ON CONFLICT(telegram_id) DO NOTHING',(uid,source,now,now if opened else 0))
   if opened:self.db.execute(c,'UPDATE telefy_acquisition SET first_open=%s WHERE telegram_id=%s AND first_open=0',(now,uid))
 def playback(self,c,uid,date,delta):
  # Called inside the usage checkpoint transaction: retries cannot count twice.
  self.db.execute(c,'INSERT INTO telefy_analytics_daily(telegram_id,day,listened_ms) VALUES(%s,%s,%s) ON CONFLICT(telegram_id,day) DO UPDATE SET listened_ms=telefy_analytics_daily.listened_ms+excluded.listened_ms',(uid,date,max(0,int(delta))))
 def event(self,uid,event,key,now=None):
  columns={'app_open':'opens','like':'likes','playlist_create':'playlists','export_request':'exports','playback_error':'errors'}
  if event not in columns or not re.fullmatch(r'[A-Za-z0-9_-]{16,64}',str(key)):raise ValueError('invalid_event')
  self.ensure();now=int(time.time())if now is None else int(now);date=day(now)
  if event=='app_open':self.acquire(uid,opened=True,now=now)
  with LOCK,self.db.connect()as c:
   if self.db.url:self.db.execute(c,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s FOR UPDATE',(uid,))
   n=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_analytics_events WHERE telegram_id=%s AND day=%s',(uid,date)).fetchone()['n']
   if n>=1000:return
   changed=self.db.execute(c,'INSERT INTO telefy_analytics_events VALUES(%s,%s,%s) ON CONFLICT(telegram_id,event_id) DO NOTHING',(uid,key,date))
   if changed.rowcount:
    column=columns[event]
    self.db.execute(c,'INSERT INTO telefy_analytics_daily(telegram_id,day,'+column+') VALUES(%s,%s,1) ON CONFLICT(telegram_id,day) DO UPDATE SET '+column+'=telefy_analytics_daily.'+column+'+1',(uid,date))
   cutoff=day(now-180*86400)
   self.db.execute(c,'DELETE FROM telefy_analytics_events WHERE day<%s',(cutoff,));self.db.execute(c,'DELETE FROM telefy_analytics_daily WHERE day<%s',(cutoff,))
 def reports(self,now=None):
  self.ensure();now=int(time.time())if now is None else int(now);today=day(now);cutoff=day(now-29*86400)
  with self.db.connect()as c:
   daily=[dict(r)for r in self.db.execute(c,'SELECT * FROM telefy_analytics_daily WHERE day>=%s',(cutoff,)).fetchall()]
   people=[dict(r)for r in self.db.execute(c,'SELECT a.* FROM telefy_acquisition a LEFT JOIN telefy_users u ON u.telegram_id=a.telegram_id WHERE a.first_open=0 OR u.telegram_id IS NOT NULL').fetchall()]
   started=self.db.execute(c,'SELECT started_at FROM telefy_analytics_meta WHERE id=1').fetchone()['started_at']
   tables={r['name']for r in self.db.execute(c,"SELECT name FROM sqlite_master WHERE type='table'").fetchall()}if not self.db.url else None
   payments=[]
   has_payments=bool(self.db.execute(c,"SELECT to_regclass('telefy_star_orders') AS name").fetchone()['name'])if self.db.url else'telefy_star_orders'in tables
   if has_payments:
    payments=[dict(r)for r in self.db.execute(c,"SELECT telegram_id,amount,paid_at,state FROM telefy_star_orders WHERE state IN ('paid','refunded') AND paid_at>=%s",(started,)).fetchall()]
  listening={(r['telegram_id'],r['day'])for r in daily if r['listened_ms']>=30000}
  days=[]
  for date in sorted({r['day']for r in daily}):
   rows=[r for r in daily if r['day']==date];days.append({'day_moscow':date,'app_users':sum(r['opens']>0 for r in rows),'listeners_30s':sum(r['listened_ms']>=30000 for r in rows),'minutes':round(sum(r['listened_ms']for r in rows)/60000,2),'app_opens':sum(r['opens']for r in rows),'like_actions':sum(r['likes']for r in rows),'playlist_create_actions':sum(r['playlists']for r in rows),'export_requests':sum(r['exports']for r in rows),'playback_errors':sum(r['errors']for r in rows)})
  cohorts=[]
  for date in sorted({day(p['first_open'])for p in people if p['first_open']and p['source']!='existing'and day(p['first_open'])>=cutoff}):
   ids={p['telegram_id']for p in people if p['first_open']and p['source']!='existing'and day(p['first_open'])==date}
   row={'cohort_day_moscow':date,'new_app_users':len(ids),'activated_30s_day0':sum((uid,date)in listening for uid in ids)}
   for n in [1,7]:
    target=(datetime.fromisoformat(date)+timedelta(days=n)).date().isoformat();count=sum((uid,target)in listening for uid in ids)
    row['D'+str(n)+'_listeners']=count if target<today else'not_mature';row['D'+str(n)+'_percent']=round(count/len(ids)*100,1)if target<today else'not_mature'
   cohorts.append(row)
  sources=[]
  for source in sorted({p['source']for p in people}):
   members=[p for p in people if p['source']==source];ids={p['telegram_id']for p in members};paid=[p for p in payments if p['telegram_id']in ids and p['state']=='paid']
   sources.append({'source':source,'attributed_users_since_start':len(ids),'ever_opened_app':sum(bool(p['first_open'])for p in members),'listeners_30s_last30d':len({uid for uid,date in listening if uid in ids}),'paying_users_since_start':len({p['telegram_id']for p in paid}),'paid_stars_since_start':sum(p['amount']for p in paid),'refunded_stars_since_start':sum(p['amount']for p in payments if p['telegram_id']in ids and p['state']=='refunded')})
  recent=[r for r in daily if r['day']>=day(now-6*86400)]
  summary={'listeners_7d':len({r['telegram_id']for r in recent if r['listened_ms']>=30000}),'minutes_7d':round(sum(r['listened_ms']for r in recent)/60000,1)}
  for n in [1,7]:
   mature=[r for r in cohorts if isinstance(r['D'+str(n)+'_listeners'],int)];den=sum(r['new_app_users']for r in mature)
   summary['D'+str(n)]=str(round(100*sum(r['D'+str(n)+'_listeners']for r in mature)/den,1))+'% (из '+str(den)+')'if den else'ещё нет полных когорт'
  return {'started':started,'days':days,'cohorts':cohorts,'sources':sources,'summary':summary}
def store():
 import bot_reminders
 db=bot_reminders.store().db
 with LOCK:
  if not getattr(db,'analytics_store',None):db.analytics_store=Analytics(db)
 result=db.analytics_store;result.ensure();return result
def csv_bytes(rows):
 output=io.StringIO(newline='');fields=list(rows[0])if rows else['no_data'];writer=csv.DictWriter(output,fieldnames=fields);writer.writeheader();writer.writerows(rows);return ('\ufeff'+output.getvalue()).encode('utf-8')
def send_csv(uid,name,rows):
 import telefy_bot as bot
 from urllib.request import Request,urlopen
 boundary='Telefy'+secrets.token_hex(16)
 body=(f'--{boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{uid}\r\n--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="telefy-{name}.csv"\r\nContent-Type: text/csv; charset=utf-8\r\n\r\n').encode()+csv_bytes(rows)+f'\r\n--{boundary}--\r\n'.encode()
 with urlopen(Request('https://api.telegram.org/bot'+bot.TOKEN+'/sendDocument',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary}),timeout=25)as response:
  if not json.load(response).get('ok'):raise ValueError('csv_delivery_failed')
def handle(update):
 import telefy_bot as bot,bot_reminders as rem,bot_posts as posts
 cb=update.get('callback_query')or{};msg=update.get('message')or{};user=cb.get('from')or msg.get('from')or{};chat=(cb.get('message')or msg).get('chat')or{};data=cb.get('data','');command=msg.get('text','').split(' ',1)[0]
 if not(data.startswith('analytics_')or command=='/analytics'):return False
 if chat.get('type')!='private'or not bot.valid_user(user)or user['id']not in rem.admins():return True
 uid=user['id']
 if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'])
 try:
  reports=store().reports();since=datetime.fromtimestamp(reports['started'],TZ).strftime('%d.%m.%Y %H:%M')
  kind=data.removeprefix('analytics_csv_')
  if data.startswith('analytics_csv_')and kind in('days','cohorts','sources'):send_csv(uid,kind,reports[kind]);return True
  current=next((r for r in reports['days']if r['day_moscow']==day()),{})
  text=f'📈 Аналитика Telefy\n\nСбор с {since} МСК.\nСегодня: открывали {current.get("app_users",0)}, слушали ≥30 с — {current.get("listeners_30s",0)}.\nПрослушано: {current.get("minutes",0)} мин.\nОшибок плеера: {current.get("playback_errors",0)}.\n\nCSV: активность и когорты за 30 дней; источники — с начала сбора. D1/D7 — слушали ≥30 с в соответствующий календарный день МСК. Неполные дни: not_mature. Исторические данные не восстановлены.\n\nЛайки/плейлисты/выгрузки — действия пользователя, не подтверждённые результаты. Минуты — фактическое воспроизведение, включая Max/бету.'
  summary=reports['summary'];text+='\n\nЗа 7 календарных дней: '+str(summary['listeners_7d'])+' слушателей, '+str(summary['minutes_7d'])+' мин.\nD1: '+summary['D1']+'\nD7: '+summary['D7']
  posts.say(uid,text,[[posts.button('📅 Активность CSV','analytics_csv_days')],[posts.button('↩️ Возвращаемость CSV','analytics_csv_cohorts')],[posts.button('📣 Источники CSV','analytics_csv_sources')]])
 except Exception:posts.say(uid,'Аналитика временно недоступна. Повтори позже. Данные не удалены.')
 return True

def observe(update):
 msg=update.get('message')or{};text=msg.get('text','');user=msg.get('from')or{}
 if(msg.get('chat')or{}).get('type')=='private'and type(user.get('id'))is int and text.split(' ',1)[0].split('@')[0]=='/start':
  try:store().acquire(user['id'],text.split(' ',1)[1]if' 'in text else'')
  except Exception:pass

def route(handler):
 try:
  if not handler.same_origin():handler.reply(403,{'error':'origin_rejected'});return
  user=handler.bot_user()
  if not user:return
  n=int(handler.headers.get('Content-Length','0'))
  if not 0<n<=512:raise ValueError()
  body=json.loads(handler.rfile.read(n));store().event(user['telegram_id'],body.get('event'),body.get('event_id'));handler.reply(200,{'ok':True})
 except(ValueError,TypeError,AttributeError):handler.reply(400,{'error':'invalid_event'})
 except Exception:handler.reply(503,{'error':'analytics_unavailable'})

"""Account inactivity cycles, reminder reservations and admin-owned Telegram media IDs."""
import time,threading,secrets
from max_billing import month_after

STAGES=('48h','3d','7d','14d','1m')
MEDIA_STAGES=('welcome',)+STAGES
NEVER=9223372036854770000
def deadlines(anchor):return (anchor+48*3600,anchor+3*86400,anchor+7*86400,anchor+14*86400,month_after(anchor))
def next_due(anchor,mask):return next((at for i,at in enumerate(deadlines(anchor))if not mask&(1<<i)),NEVER)

class ReminderStore:
 def __init__(self,db):self.db=db;self.lock=threading.Lock();self.ready=False;self.cleaned_at=0
 def ensure(self):
  self.db.ensure()
  with self.lock:
   if self.ready:return
   with self.db.connect()as c:
    if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620113)')
    for sql in ['''CREATE TABLE IF NOT EXISTS telefy_reminder_contacts (
     telegram_id BIGINT PRIMARY KEY REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,
     enabled INTEGER NOT NULL,chat_started INTEGER NOT NULL,reachable INTEGER NOT NULL,
     anchor BIGINT NOT NULL,last_app_at BIGINT NOT NULL,cycle BIGINT NOT NULL,mask INTEGER NOT NULL,
     next_due BIGINT NOT NULL,retry_at BIGINT NOT NULL)''',
     '''CREATE INDEX IF NOT EXISTS telefy_reminder_due_idx ON telefy_reminder_contacts(next_due,retry_at)''',
     '''CREATE TABLE IF NOT EXISTS telefy_reminder_deliveries (
     delivery_id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,
     cycle BIGINT NOT NULL,stage INTEGER NOT NULL,status TEXT NOT NULL,created_at BIGINT NOT NULL,
     UNIQUE(telegram_id,cycle,stage))''',
     '''CREATE TABLE IF NOT EXISTS telefy_reminder_media (stage TEXT PRIMARY KEY,kind TEXT NOT NULL,file_id TEXT NOT NULL,updated_by BIGINT NOT NULL,updated_at BIGINT NOT NULL)''',
     '''CREATE INDEX IF NOT EXISTS telefy_reminder_delivery_age_idx ON telefy_reminder_deliveries(created_at)''',
     '''CREATE TABLE IF NOT EXISTS telefy_reminder_uploads (admin_id BIGINT PRIMARY KEY,stage TEXT NOT NULL,expires_at BIGINT NOT NULL)''']:
     self.db.execute(c,sql)
   self.ready=True
 def register(self,uid,now=None):
  self.ensure();now=int(time.time())if now is None else int(now)
  with self.db.connect()as c:
   self.db.execute(c,'''INSERT INTO telefy_reminder_contacts VALUES(%s,1,1,1,%s,0,1,0,%s,0)
     ON CONFLICT(telegram_id) DO UPDATE SET chat_started=1,reachable=1,
     anchor=CASE WHEN telefy_reminder_contacts.chat_started=0 THEN excluded.anchor ELSE telefy_reminder_contacts.anchor END,
     cycle=CASE WHEN telefy_reminder_contacts.chat_started=0 THEN telefy_reminder_contacts.cycle+1 ELSE telefy_reminder_contacts.cycle END,
     mask=CASE WHEN telefy_reminder_contacts.chat_started=0 THEN 0 ELSE telefy_reminder_contacts.mask END,
     next_due=CASE WHEN telefy_reminder_contacts.chat_started=0 THEN excluded.next_due ELSE telefy_reminder_contacts.next_due END''',(uid,now,now+48*3600))
 def enroll_known(self):
  """Only previous bot contacts have proof of a private conversation."""
  self.ensure()
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT DISTINCT l.telegram_id FROM telefy_bot_launches l JOIN telefy_users u ON u.telegram_id=l.telegram_id').fetchall()
  for row in rows:self.register(row['telegram_id'])
 def activity(self,uid,now=None):
  self.ensure();now=int(time.time())if now is None else int(now)
  with self.db.connect()as c:
   self.db.execute(c,'''INSERT INTO telefy_reminder_contacts VALUES(%s,1,0,1,%s,%s,1,0,%s,0)
     ON CONFLICT(telegram_id) DO UPDATE SET anchor=excluded.anchor,last_app_at=excluded.last_app_at,
     cycle=telefy_reminder_contacts.cycle+1,mask=0,next_due=excluded.next_due,retry_at=0
     WHERE telefy_reminder_contacts.last_app_at<=%s''',(uid,now,now,now+48*3600,now-120))
 def prefs(self,uid):
  self.ensure()
  with self.db.connect()as c:row=self.db.execute(c,'SELECT enabled,chat_started FROM telefy_reminder_contacts WHERE telegram_id=%s',(uid,)).fetchone()
  return {'enabled':bool(row['enabled'])if row else True,'chat_started':bool(row['chat_started'])if row else False}
 def toggle(self,uid,on,now=None):
  if type(on)is not bool:raise ValueError('invalid_preference')
  self.ensure();now=int(time.time())if now is None else int(now)
  with self.db.connect()as c:
   self.db.execute(c,'INSERT INTO telefy_reminder_contacts VALUES(%s,1,0,1,%s,0,1,0,%s,0) ON CONFLICT(telegram_id) DO NOTHING',(uid,now,now+48*3600))
   if on:self.db.execute(c,'UPDATE telefy_reminder_contacts SET enabled=1,anchor=%s,cycle=cycle+1,mask=0,next_due=%s,retry_at=0 WHERE telegram_id=%s',(now,now+48*3600,uid))
   else:self.db.execute(c,'UPDATE telefy_reminder_contacts SET enabled=0 WHERE telegram_id=%s',(uid,))
  return self.prefs(uid)
 def reachable(self,uid,on):
  self.ensure()
  with self.db.connect()as c:self.db.execute(c,'UPDATE telefy_reminder_contacts SET reachable=%s WHERE telegram_id=%s',(int(on),uid))
 def candidate(self,now=None):
  self.ensure();now=int(time.time())if now is None else int(now)
  if now-self.cleaned_at>=3600:
   with self.db.connect()as c:
    self.db.execute(c,'DELETE FROM telefy_reminder_deliveries WHERE created_at<%s',(now-90*86400,))
    self.db.execute(c,'DELETE FROM telefy_reminder_uploads WHERE expires_at<%s',(now,))
   self.cleaned_at=now
  with self.db.connect()as c:row=self.db.execute(c,'SELECT * FROM telefy_reminder_contacts WHERE enabled=1 AND chat_started=1 AND reachable=1 AND next_due<=%s AND retry_at<=%s ORDER BY next_due,telegram_id LIMIT 1',(now,now)).fetchone()
  return dict(row)if row else None
 def defer(self,uid,cycle,until):
  with self.db.connect()as c:self.db.execute(c,'UPDATE telefy_reminder_contacts SET retry_at=%s WHERE telegram_id=%s AND cycle=%s',(until,uid,cycle))
 def reserve(self,row,now=None):
  self.ensure();now=int(time.time())if now is None else int(now)
  due=[i for i,at in enumerate(deadlines(row['anchor']))if at<=now and not row['mask']&(1<<i)]
  if not due:return None
  stage=due[-1];mask=row['mask']|sum(1<<i for i in due);token=secrets.token_hex(16)
  with self.db.connect()as c:
   changed=self.db.execute(c,'UPDATE telefy_reminder_contacts SET mask=%s,next_due=%s WHERE telegram_id=%s AND cycle=%s AND mask=%s AND enabled=1 AND reachable=1 AND retry_at<=%s',(mask,next_due(row['anchor'],mask),row['telegram_id'],row['cycle'],row['mask'],now))
   if changed.rowcount!=1:return None
   self.db.execute(c,'INSERT INTO telefy_reminder_deliveries VALUES(%s,%s,%s,%s,%s,%s)',(token,row['telegram_id'],row['cycle'],stage,'reserved',now))
  return {'id':token,'uid':row['telegram_id'],'cycle':row['cycle'],'stage':stage}
 def current(self,job):
  with self.db.connect()as c:row=self.db.execute(c,'SELECT cycle,enabled,reachable FROM telefy_reminder_contacts WHERE telegram_id=%s',(job['uid'],)).fetchone()
  return bool(row and row['cycle']==job['cycle']and row['enabled']and row['reachable'])
 def finish(self,job,status,retry=None,now=None):
  now=int(time.time())if now is None else int(now)
  with self.db.connect()as c:
   self.db.execute(c,'UPDATE telefy_reminder_deliveries SET status=%s WHERE delivery_id=%s',(status,job['id']))
   if retry is not None:
    row=self.db.execute(c,'SELECT * FROM telefy_reminder_contacts WHERE telegram_id=%s'+(' FOR UPDATE'if self.db.url else ''),(job['uid'],)).fetchone()
    if row and row['cycle']==job['cycle']:
     mask=row['mask']&~(1<<job['stage']);self.db.execute(c,'UPDATE telefy_reminder_contacts SET mask=%s,next_due=%s,retry_at=%s WHERE telegram_id=%s',(mask,next_due(row['anchor'],mask),now+int(retry),job['uid']))
     # A definitive rejection allows another attempt for the same stage.
     self.db.execute(c,'DELETE FROM telefy_reminder_deliveries WHERE delivery_id=%s',(job['id'],))
   self.db.execute(c,'DELETE FROM telefy_reminder_deliveries WHERE created_at<%s',(now-90*86400,))
 def media(self,stage):
  if stage not in MEDIA_STAGES:raise ValueError('invalid_stage')
  self.ensure()
  with self.db.connect()as c:row=self.db.execute(c,'SELECT kind,file_id FROM telefy_reminder_media WHERE stage=%s',(stage,)).fetchone()
  return dict(row)if row else None
 def upload_stage(self,admin,stage):
  self.ensure()
  if stage not in MEDIA_STAGES:raise ValueError('invalid_stage')
  with self.db.connect()as c:self.db.execute(c,'INSERT INTO telefy_reminder_uploads VALUES(%s,%s,%s) ON CONFLICT(admin_id) DO UPDATE SET stage=excluded.stage,expires_at=excluded.expires_at',(admin,stage,int(time.time())+600))
 def pending_upload(self,admin):
  self.ensure()
  with self.db.connect()as c:row=self.db.execute(c,'SELECT stage FROM telefy_reminder_uploads WHERE admin_id=%s AND expires_at>%s',(admin,int(time.time()))).fetchone()
  return row['stage']if row else None
 def cancel_upload(self,admin):
  self.ensure()
  with self.db.connect()as c:self.db.execute(c,'DELETE FROM telefy_reminder_uploads WHERE admin_id=%s',(admin,))
 def set_media(self,stage,kind,file_id,admin):
  if stage not in MEDIA_STAGES or kind not in('photo','video','animation','audio','document')or not isinstance(file_id,str)or not 0<len(file_id)<=4096:raise ValueError('invalid_media')
  self.ensure()
  with self.db.connect()as c:
   self.db.execute(c,'INSERT INTO telefy_reminder_media VALUES(%s,%s,%s,%s,%s) ON CONFLICT(stage) DO UPDATE SET kind=excluded.kind,file_id=excluded.file_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at',(stage,kind,file_id,admin,int(time.time())))
   self.db.execute(c,'DELETE FROM telefy_reminder_uploads WHERE admin_id=%s',(admin,))
 def clear_media(self,stage):
  if stage not in MEDIA_STAGES:raise ValueError('invalid_stage')
  self.ensure()
  with self.db.connect()as c:self.db.execute(c,'DELETE FROM telefy_reminder_media WHERE stage=%s',(stage,))

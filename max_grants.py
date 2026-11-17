"""Auditable admin grants; never represented as successful payments."""
import threading,time,secrets
LOCK=threading.RLock()
class GrantStore:
 def __init__(self,db):self.db=db;self.ready=False
 def ensure(self):
  with LOCK:
   if self.ready:return
   self.db.ensure()
   with self.db.connect()as c:
    for sql in [
     'CREATE TABLE IF NOT EXISTS telefy_max_grants(id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,admin_id BIGINT NOT NULL,days INTEGER NOT NULL,created_at BIGINT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_max_grant_drafts(id TEXT PRIMARY KEY,admin_id BIGINT NOT NULL,telegram_id BIGINT NOT NULL,days INTEGER NOT NULL,expires_at BIGINT NOT NULL,state TEXT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_max_grant_inputs(admin_id BIGINT PRIMARY KEY,phase TEXT NOT NULL,target_id BIGINT NOT NULL,expires_at BIGINT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_max_price(id INTEGER PRIMARY KEY,amount INTEGER NOT NULL,version INTEGER NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_max_price_changes(id TEXT PRIMARY KEY,admin_id BIGINT NOT NULL,amount INTEGER NOT NULL,version INTEGER NOT NULL,expires_at BIGINT NOT NULL,state TEXT NOT NULL,applied_at BIGINT NOT NULL)']:
     self.db.execute(c,sql)
    self.db.execute(c,'INSERT INTO telefy_max_price VALUES(1,100,1) ON CONFLICT(id) DO NOTHING')
   self.ready=True
 def events(self,uid):
  self.ensure()
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT created_at,days FROM telefy_max_grants WHERE telegram_id=%s ORDER BY created_at,id',(uid,)).fetchall()
  return [(r['created_at'],r['days']*86400)for r in rows]
 def price(self):
  self.ensure()
  with self.db.connect()as c:return dict(self.db.execute(c,'SELECT amount,version FROM telefy_max_price WHERE id=1').fetchone())
 def price_draft(self,admin,amount):
  if type(amount)is not int or not 1<=amount<=100000:raise ValueError('price')
  token=secrets.token_hex(12);version=self.price()['version']
  with self.db.connect()as c:self.db.execute(c,"INSERT INTO telefy_max_price_changes VALUES(%s,%s,%s,%s,%s,'draft',0)",(token,admin,amount,version,int(time.time())+900))
  self.clear(admin);return token
 def apply_price(self,admin,token,cancel=False):
  self.ensure()
  with LOCK,self.db.connect()as c:
   r=self.db.execute(c,'SELECT * FROM telefy_max_price_changes WHERE id=%s AND admin_id=%s'+(' FOR UPDATE'if self.db.url else''),(token,admin)).fetchone()
   if not r or r['state']!='draft'or r['expires_at']<int(time.time()):return False
   if cancel:self.db.execute(c,"UPDATE telefy_max_price_changes SET state='cancelled' WHERE id=%s",(token,));return True
   current=self.db.execute(c,'SELECT version FROM telefy_max_price WHERE id=1'+(' FOR UPDATE'if self.db.url else'')).fetchone()
   if current['version']!=r['version']:return False
   self.db.execute(c,'UPDATE telefy_max_price SET amount=%s,version=version+1 WHERE id=1',(r['amount'],))
   self.db.execute(c,"UPDATE telefy_max_price_changes SET state='applied',applied_at=%s WHERE id=%s",(int(time.time()),token))
   self.db.execute(c,'UPDATE telefy_app_control SET generation=generation+1,updated_at=%s,updated_by=%s WHERE id=1',(int(time.time()),admin))
   return True
 def profile(self,username):
  self.ensure()
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT telegram_id,username,first_name,last_name FROM telefy_users WHERE LOWER(username)=%s',(username.lstrip('@').lower(),)).fetchall()
  return dict(rows[0])if len(rows)==1 else None
 def user(self,uid):
  with self.db.connect()as c:r=self.db.execute(c,'SELECT telegram_id,username,first_name,last_name FROM telefy_users WHERE telegram_id=%s',(uid,)).fetchone()
  return dict(r)if r else None
 def input(self,admin,phase=None,target=0):
  self.ensure()
  with self.db.connect()as c:
   if phase:self.db.execute(c,'INSERT INTO telefy_max_grant_inputs VALUES(%s,%s,%s,%s) ON CONFLICT(admin_id) DO UPDATE SET phase=excluded.phase,target_id=excluded.target_id,expires_at=excluded.expires_at',(admin,phase,target,int(time.time())+900));return
   r=self.db.execute(c,'SELECT * FROM telefy_max_grant_inputs WHERE admin_id=%s AND expires_at>%s',(admin,int(time.time()))).fetchone()
  return dict(r)if r else None
 def clear(self,admin):
  self.ensure()
  with self.db.connect()as c:self.db.execute(c,'DELETE FROM telefy_max_grant_inputs WHERE admin_id=%s',(admin,))
 def draft(self,admin,uid,days):
  if type(days)is not int or not 1<=days<=365:raise ValueError('days')
  token=secrets.token_hex(12)
  with self.db.connect()as c:
   self.db.execute(c,"UPDATE telefy_max_grant_drafts SET state='cancelled' WHERE admin_id=%s AND state='draft'",(admin,))
   self.db.execute(c,"INSERT INTO telefy_max_grant_drafts VALUES(%s,%s,%s,%s,%s,'draft')",(token,admin,uid,days,int(time.time())+900))
  self.clear(admin);return token
 def apply(self,admin,token,cancel=False):
  self.ensure()
  with LOCK,self.db.connect()as c:
   r=self.db.execute(c,'SELECT * FROM telefy_max_grant_drafts WHERE id=%s AND admin_id=%s'+(' FOR UPDATE'if self.db.url else''),(token,admin)).fetchone()
   if not r or r['state']!='draft'or r['expires_at']<int(time.time()):return None
   if cancel:self.db.execute(c,"UPDATE telefy_max_grant_drafts SET state='cancelled' WHERE id=%s",(token,));return dict(r)
   if not self.db.execute(c,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s',(r['telegram_id'],)).fetchone():return None
   self.db.execute(c,'INSERT INTO telefy_max_grants VALUES(%s,%s,%s,%s,%s)',(token,r['telegram_id'],admin,r['days'],int(time.time())))
   self.db.execute(c,"UPDATE telefy_max_grant_drafts SET state='granted' WHERE id=%s",(token,))
   return dict(r)

def store():
 import bot_reminders as rem
 db=rem.store().db
 with LOCK:
  if not getattr(db,'max_grant_store',None):db.max_grant_store=GrantStore(db)
 result=db.max_grant_store;result.ensure();return result

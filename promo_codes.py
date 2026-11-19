"""Atomic gift grants and payment-confirmed, capacity-limited Stars discounts."""
import json,re,secrets,threading,time
from urllib.parse import urlsplit
LOCK=threading.RLock()
ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

class PromoError(Exception):
 def __init__(self,status,code):self.status,self.code=status,code

def normalize(value):
 if not isinstance(value,str)or len(value)>32:raise PromoError(400,'promo_format')
 value=value.strip().upper()
 if not re.fullmatch(r'[A-Z0-9]{4}-?[A-Z0-9]{4}',value):raise PromoError(400,'promo_format')
 return value.replace('-','')[:4]+'-'+value.replace('-','')[4:]

class PromoStore:
 def __init__(self,db):self.db=db;self.ready=False
 def ensure(self):
  with LOCK:
   if self.ready:return
   import max_grants
   max_grants.GrantStore(self.db).ensure()
   with self.db.connect()as c:
    for sql in [
     'CREATE TABLE IF NOT EXISTS telefy_promos(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,admin_id BIGINT NOT NULL,days INTEGER NOT NULL,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,max_uses INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,deleted_at BIGINT NOT NULL DEFAULT 0)',
     'CREATE TABLE IF NOT EXISTS telefy_promo_claims(promo_id TEXT NOT NULL REFERENCES telefy_promos(id),telegram_id BIGINT NOT NULL,grant_id TEXT UNIQUE NOT NULL,claimed_at BIGINT NOT NULL,username TEXT,PRIMARY KEY(promo_id,telegram_id))',
     'CREATE TABLE IF NOT EXISTS telefy_promo_attempts(id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,created_at BIGINT NOT NULL)',
     'CREATE INDEX IF NOT EXISTS telefy_promo_attempt_time ON telefy_promo_attempts(telegram_id,created_at)',
     'CREATE TABLE IF NOT EXISTS telefy_promo_inputs(admin_id BIGINT PRIMARY KEY,stage TEXT NOT NULL,payload TEXT NOT NULL,expires_at BIGINT NOT NULL)']:
     self.db.execute(c,sql)
    for name,definition in [('kind',"TEXT NOT NULL DEFAULT 'gift'"),('percent','INTEGER NOT NULL DEFAULT 0')]:
     if self.db.url:self.db.execute(c,'ALTER TABLE telefy_promos ADD COLUMN IF NOT EXISTS '+name+' '+definition)
     elif name not in [r['name']for r in self.db.execute(c,'PRAGMA table_info(telefy_promos)').fetchall()]:self.db.execute(c,'ALTER TABLE telefy_promos ADD COLUMN '+name+' '+definition)
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_promo_selected(telegram_id BIGINT PRIMARY KEY,promo_id TEXT NOT NULL REFERENCES telefy_promos(id))')
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_promo_orders(order_id TEXT PRIMARY KEY,promo_id TEXT NOT NULL REFERENCES telefy_promos(id),telegram_id BIGINT NOT NULL,reserved_at BIGINT NOT NULL,paid_at BIGINT NOT NULL DEFAULT 0,UNIQUE(promo_id,telegram_id))')
   self.ready=True
 def input(self,admin,stage=None,payload=None):
  self.ensure()
  with self.db.connect()as c:
   if stage:self.db.execute(c,'INSERT INTO telefy_promo_inputs VALUES(%s,%s,%s,%s) ON CONFLICT(admin_id) DO UPDATE SET stage=excluded.stage,payload=excluded.payload,expires_at=excluded.expires_at',(admin,stage,json.dumps(payload or{}),int(time.time())+1800));return
   row=self.db.execute(c,'SELECT * FROM telefy_promo_inputs WHERE admin_id=%s AND expires_at>%s',(admin,int(time.time()))).fetchone()
  return {**dict(row),'payload':json.loads(row['payload'])}if row else None
 def cancel(self,admin):
  self.ensure()
  with self.db.connect()as c:self.db.execute(c,'DELETE FROM telefy_promo_inputs WHERE admin_id=%s',(admin,))
 def _create(self,c,admin,days,expiry,limit,now,kind='gift',percent=0):
  if kind not in ('gift','discount')or (kind=='discount'and(type(percent)is not int or not 1<=percent<=99)):raise PromoError(400,'invalid_promo_settings')
  if type(days)is not int or not 1<=days<=365 or type(limit)is not int or not 1<=limit<=1000000 or type(expiry)is not int or expiry<=now:raise PromoError(400,'invalid_promo_settings')
  code=normalize(''.join(secrets.choice(ALPHABET)for _ in range(8)));identity=secrets.token_hex(12)
  self.db.execute(c,'INSERT INTO telefy_promos(id,code,admin_id,days,created_at,expires_at,max_uses,kind,percent) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)',(identity,code,admin,days,now,expiry,limit,kind,percent))
  return {'id':identity,'code':code,'days':days,'expires_at':expiry,'max_uses':limit,'used':0,'deleted_at':0,'kind':kind,'percent':percent}
 def create(self,admin,days,expiry,limit,now=None,kind='gift',percent=0):
  self.ensure();now=int(time.time())if now is None else now
  with LOCK,self.db.connect()as c:return self._create(c,admin,days,expiry,limit,now,kind,percent)
 def issue(self,admin):
  self.ensure();now=int(time.time())
  with LOCK,self.db.connect()as c:
   row=self.db.execute(c,'SELECT * FROM telefy_promo_inputs WHERE admin_id=%s'+(' FOR UPDATE'if self.db.url else''),(admin,)).fetchone()
   if not row or row['stage']!='confirm'or row['expires_at']<=now:return None
   data=json.loads(row['payload']);result=self._create(c,admin,data['days'],data['expiry'],data['limit'],now,data.get('kind','gift'),data.get('percent',0))
   self.db.execute(c,'DELETE FROM telefy_promo_inputs WHERE admin_id=%s',(admin,));return result
 def redeem(self,uid,value,now=None):
  self.ensure();now=int(time.time())if now is None else now;error=None;result=None
  with LOCK,self.db.connect()as c:
   user=self.db.execute(c,'SELECT username FROM telefy_users WHERE telegram_id=%s'+(' FOR UPDATE'if self.db.url else''),(uid,)).fetchone()
   if not user:raise PromoError(401,'login_required')
   self.db.execute(c,'DELETE FROM telefy_promo_attempts WHERE created_at<%s',(now-600,))
   count=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_promo_attempts WHERE telegram_id=%s',(uid,)).fetchone()['n']
   if count>=10:error=PromoError(429,'promo_rate_limited')
   else:
    self.db.execute(c,'INSERT INTO telefy_promo_attempts VALUES(%s,%s,%s)',(secrets.token_hex(12),uid,now))
    try:code=normalize(value)
    except PromoError as e:error=e
    if not error:
     row=self.db.execute(c,'SELECT * FROM telefy_promos WHERE code=%s'+(' FOR UPDATE'if self.db.url else''),(code,)).fetchone()
     if not row:error=PromoError(404,'promo_not_found')
     elif row['deleted_at']:error=PromoError(409,'promo_disabled')
     elif row['expires_at']<=now:error=PromoError(409,'promo_expired')
     elif self.db.execute(c,'SELECT grant_id FROM telefy_promo_claims WHERE promo_id=%s AND telegram_id=%s',(row['id'],uid)).fetchone():error=PromoError(409,'promo_already_used')
     elif row['used']>=row['max_uses']:error=PromoError(409,'promo_exhausted')
     elif row['kind']=='discount':
      reserved=self.db.execute(c,'SELECT order_id FROM telefy_promo_orders WHERE promo_id=%s AND telegram_id=%s',(row['id'],uid)).fetchone()
      if reserved:error=PromoError(409,'promo_already_used')
      else:
       self.db.execute(c,'INSERT INTO telefy_promo_selected VALUES(%s,%s) ON CONFLICT(telegram_id) DO UPDATE SET promo_id=excluded.promo_id',(uid,row['id']))
       result={'kind':'discount','percent':row['percent']}
     else:
      grant='promo_'+secrets.token_hex(20)
      self.db.execute(c,'INSERT INTO telefy_max_grants VALUES(%s,%s,%s,%s,%s)',(grant,uid,row['admin_id'],row['days'],now))
      self.db.execute(c,'INSERT INTO telefy_promo_claims VALUES(%s,%s,%s,%s,%s)',(row['id'],uid,grant,now,user['username']))
      self.db.execute(c,'UPDATE telefy_promos SET used=used+1 WHERE id=%s',(row['id'],))
      result={'days':row['days'],'grant_id':grant}
  # Errors leave the transaction normally, so failed attempts remain rate-limited.
  if error:raise error
  return result
 def quote(self,uid,base):
  self.ensure()
  with self.db.connect()as c:
   row=self.db.execute(c,'SELECT p.* FROM telefy_promos p JOIN telefy_promo_selected s ON s.promo_id=p.id WHERE s.telegram_id=%s',(uid,)).fetchone()
   if not row or row['deleted_at']or row['expires_at']<=time.time()or row['used']>=row['max_uses']:return None
   pending=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_promo_orders WHERE promo_id=%s AND paid_at=0',(row['id'],)).fetchone()['n']
   if row['used']+pending>=row['max_uses']:return None
   if self.db.execute(c,'SELECT order_id FROM telefy_promo_orders WHERE promo_id=%s AND telegram_id=%s',(row['id'],uid)).fetchone():return None
  return {'promo_id':row['id'],'code':row['code'],'percent':row['percent'],'amount':max(1,(base*(100-row['percent'])+99)//100),'regular_amount':base}
 def reserve(self,c,uid,oid,pid):
  # Called inside the authenticated pre-checkout transaction. Approved payments
  # retain their slot until Telegram delivers the result, including delayed updates.
  row=self.db.execute(c,'SELECT * FROM telefy_promos WHERE id=%s'+(' FOR UPDATE'if self.db.url else''),(pid,)).fetchone()
  if not row or row['kind']!='discount'or row['deleted_at']or row['expires_at']<=time.time():return False
  pending=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_promo_orders WHERE promo_id=%s AND paid_at=0',(pid,)).fetchone()['n']
  if row['used']+pending>=row['max_uses']:return False
  if self.db.execute(c,'SELECT order_id FROM telefy_promo_orders WHERE promo_id=%s AND telegram_id=%s',(pid,uid)).fetchone():return False
  self.db.execute(c,'INSERT INTO telefy_promo_orders(order_id,promo_id,telegram_id,reserved_at) VALUES(%s,%s,%s,%s)',(oid,pid,uid,int(time.time())))
  return True
 def paid(self,c,oid):
  row=self.db.execute(c,'SELECT * FROM telefy_promo_orders WHERE order_id=%s',(oid,)).fetchone()
  if not row or row['paid_at']:return
  self.db.execute(c,'UPDATE telefy_promo_orders SET paid_at=%s WHERE order_id=%s',(int(time.time()),oid))
  self.db.execute(c,'UPDATE telefy_promos SET used=used+1 WHERE id=%s',(row['promo_id'],))
  user=self.db.execute(c,'SELECT username FROM telefy_users WHERE telegram_id=%s',(row['telegram_id'],)).fetchone()
  self.db.execute(c,'INSERT INTO telefy_promo_claims VALUES(%s,%s,%s,%s,%s)',(row['promo_id'],row['telegram_id'],'discount_'+oid,int(time.time()),user['username']if user else None))
  self.db.execute(c,'DELETE FROM telefy_promo_selected WHERE telegram_id=%s AND promo_id=%s',(row['telegram_id'],row['promo_id']))
 def codes(self,page=0):
  self.ensure()
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT * FROM telefy_promos WHERE deleted_at=0 ORDER BY created_at DESC,id LIMIT 9 OFFSET %s',(max(0,page)*8,)).fetchall()
  return [dict(r)for r in rows[:8]],len(rows)>8
 def card(self,identity):
  self.ensure()
  with self.db.connect()as c:
   row=self.db.execute(c,'SELECT * FROM telefy_promos WHERE id=%s',(identity,)).fetchone()
   claims=self.db.execute(c,'SELECT telegram_id,username,claimed_at FROM telefy_promo_claims WHERE promo_id=%s ORDER BY claimed_at DESC LIMIT 10',(identity,)).fetchall()
   pending=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_promo_orders WHERE promo_id=%s AND paid_at=0',(identity,)).fetchone()['n']
  return ({**dict(row),'pending':pending},[dict(r)for r in claims])if row else(None,[])
 def delete(self,identity):
  self.ensure()
  with LOCK,self.db.connect()as c:
   row=self.db.execute(c,'SELECT id FROM telefy_promos WHERE id=%s'+(' FOR UPDATE'if self.db.url else''),(identity,)).fetchone()
   if not row:return False
   self.db.execute(c,'UPDATE telefy_promos SET deleted_at=%s WHERE id=%s',(int(time.time()),identity));return True

def store():
 import max_billing
 db=max_billing.STORE.db
 with LOCK:
  if not getattr(db,'promo_store',None):db.promo_store=PromoStore(db)
  result=db.promo_store
 result.ensure();return result

def route(handler,path):
 if path!='/api/max/promos/redeem':return False
 try:
  if handler.command!='POST':raise PromoError(405,'method_not_allowed')
  if not handler.same_origin():raise PromoError(403,'origin_rejected')
  user=handler.max_user()
  if not user:raise PromoError(401,'login_required')
  n=int(handler.headers.get('Content-Length','0'))
  if not 0<n<=256:raise PromoError(400,'promo_format')
  body=json.loads(handler.rfile.read(n))
  if not isinstance(body,dict):raise PromoError(400,'promo_format')
  result=store().redeem(user['telegram_id'],body.get('code'))
  import max_billing
  try:result['expires_at']=max_billing.STORE.status(user['telegram_id'],ignore_beta=True)['expires_at']
  except Exception:result['expires_at']=None
  handler.reply(200,result)
 except PromoError as e:handler.reply(e.status,{'error':e.code})
 except(ValueError,TypeError):handler.reply(400,{'error':'promo_format'})
 except Exception:handler.reply(503,{'error':'promo_unavailable'})
 return True

"""Server-owned appearance selection; custom themes require an active Max entitlement."""
import json,threading
THEMES=('default','green-day','orange-vibe','vice-city','noir-music','red-energy')
LOCK=threading.RLock()
class AppearanceStore:
 def __init__(self,db):self.db=db;self.ready=False
 def ensure(self):
  with LOCK:
   if self.ready:return
   self.db.ensure()
   with self.db.connect()as c:
    if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620120)')
    self.db.execute(c,"CREATE TABLE IF NOT EXISTS telefy_appearance(telegram_id BIGINT PRIMARY KEY REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,theme TEXT NOT NULL,updated_at BIGINT NOT NULL)")
   self.ready=True
 def get(self,uid):
  self.ensure()
  with self.db.connect()as c:row=self.db.execute(c,'SELECT theme FROM telefy_appearance WHERE telegram_id=%s',(uid,)).fetchone()
  return ('orange-vibe'if row['theme']=='yellow-vibe'else row['theme'])if row and row['theme']in THEMES+('yellow-vibe',)else'default'
 def set(self,uid,theme,active):
  if theme not in THEMES:raise ValueError('invalid_theme')
  if theme!='default'and not active:raise PermissionError('max_required')
  import time
  self.ensure()
  with self.db.connect()as c:self.db.execute(c,'INSERT INTO telefy_appearance VALUES(%s,%s,%s) ON CONFLICT(telegram_id) DO UPDATE SET theme=excluded.theme,updated_at=excluded.updated_at',(uid,theme,int(time.time())))
  return theme

def store():
 import max_billing
 db=max_billing.STORE.db
 with LOCK:
  if not getattr(db,'appearance_store',None):db.appearance_store=AppearanceStore(db)
 return db.appearance_store

def route(handler,path):
 if path!='/api/me/appearance':return False
 try:
  user=handler.max_user()
  if not user:handler.reply(401,{'error':'login_required'});return True
  import max_billing
  uid=user['telegram_id'];active=max_billing.STORE.status(uid)['active']
  if handler.command=='GET':handler.reply(200,{'theme':store().get(uid),'active':active});return True
  if handler.command!='POST':handler.reply(405,{'error':'method_not_allowed'});return True
  if not handler.same_origin():handler.reply(403,{'error':'origin_rejected'});return True
  n=int(handler.headers.get('Content-Length','0'))
  if not 0<n<=512:raise ValueError('invalid_request')
  body=json.loads(handler.rfile.read(n))
  if not isinstance(body,dict)or not isinstance(body.get('theme'),str):raise ValueError('invalid_theme')
  theme=store().set(uid,body['theme'],active);handler.reply(200,{'theme':theme,'active':active})
 except PermissionError:handler.reply(403,{'error':'max_required'})
 except(ValueError,TypeError):handler.reply(400,{'error':'invalid_theme'})
 except Exception:handler.reply(503,{'error':'appearance_unavailable'})
 return True

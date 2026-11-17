"""Telegram Stars only. Entitlement follows authenticated successful_payment updates."""
import json,time,secrets,threading,re
from urllib.parse import urlsplit
from http.cookies import SimpleCookie
from user_database import UserDatabase
from max_grants import GrantStore

PRICE=100;PERIOD=30*86400
def month_after(timestamp):
 import calendar
 from datetime import datetime,timezone,timedelta
 dt=datetime.fromtimestamp(timestamp,timezone(timedelta(hours=3)));year,month=dt.year+(dt.month==12),dt.month%12+1
 return int(dt.replace(year=year,month=month,day=min(dt.day,calendar.monthrange(year,month)[1])).timestamp())
def beta_enabled():
 STORE.ensure();return bool(STORE.grants.mode()['beta'])
def configured():
 import telefy_bot
 return bool(telefy_bot.TOKEN)and not beta_enabled()
class BillingError(Exception):
 def __init__(self,status,code):self.status,self.code=status,code

class MaxStore:
 def __init__(self,db=None):self.db=db or UserDatabase();self.lock=threading.RLock();self.ready=False;self.grants=GrantStore(self.db)
 def ensure(self):
  with self.lock:
   if self.ready:return
   self.db.ensure()
   with self.db.connect()as c:
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_star_orders(id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,request_key TEXT NOT NULL,created_at BIGINT NOT NULL,state TEXT NOT NULL,invoice_url TEXT,checkout_id TEXT,charge_id TEXT UNIQUE,paid_at BIGINT,UNIQUE(telegram_id,request_key))')
    if self.db.url:self.db.execute(c,'ALTER TABLE telefy_star_orders ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 100')
    elif 'amount'not in [r['name']for r in self.db.execute(c,'PRAGMA table_info(telefy_star_orders)').fetchall()]:self.db.execute(c,'ALTER TABLE telefy_star_orders ADD COLUMN amount INTEGER NOT NULL DEFAULT 100')
    if self.db.url:self.db.execute(c,'ALTER TABLE telefy_star_orders ADD COLUMN IF NOT EXISTS payer_username TEXT')
    elif 'payer_username'not in [r['name']for r in self.db.execute(c,'PRAGMA table_info(telefy_star_orders)').fetchall()]:self.db.execute(c,'ALTER TABLE telefy_star_orders ADD COLUMN payer_username TEXT')
    self.db.execute(c,'UPDATE telefy_star_orders SET payer_username=(SELECT username FROM telefy_users WHERE telegram_id=telefy_star_orders.telegram_id) WHERE payer_username IS NULL')
   import max_gifts
   max_gifts.ensure(self)
   self.grants.ensure()
   self.ready=True
 def order(self,oid):
  self.ensure()
  with self.db.connect()as c:r=self.db.execute(c,'SELECT * FROM telefy_star_orders WHERE id=%s',(oid,)).fetchone()
  return dict(r)if r else None
 def invoice(self,uid,key,accepted,expected=None,gift=False,gift_message=""):
  if accepted is not True:raise BillingError(400,'terms_required')
  if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',str(key)):raise BillingError(400,'invalid_request_key')
  import telefy_bot as bot
  self.ensure()
  if self.grants.mode()['beta']:raise BillingError(409,'payments_disabled_beta')
  amount=self.grants.price()['amount']
  if (100 if expected is None else expected)!=amount:raise BillingError(409,'price_changed')
  with self.lock,self.db.connect()as c:
   if self.db.url:self.db.execute(c,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s FOR UPDATE',(uid,))
   row=self.db.execute(c,'SELECT * FROM telefy_star_orders WHERE telegram_id=%s AND request_key=%s',(uid,key)).fetchone()
   if not row:
    n=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_star_orders WHERE telegram_id=%s AND created_at>%s',(uid,int(time.time())-3600)).fetchone()['n']
    if n>=10:raise BillingError(429,'too_many_invoices')
    oid=secrets.token_hex(24)
    self.db.execute(c,'INSERT INTO telefy_star_orders(id,telegram_id,request_key,created_at,state,amount,payer_username) VALUES(%s,%s,%s,%s,%s,%s,(SELECT username FROM telefy_users WHERE telegram_id=%s))',(oid,uid,key,int(time.time()),'created',amount,uid))
    if gift:
     import max_gifts
     max_gifts.create(self,c,oid,gift_message)
   else:
    import max_gifts
    if bool(max_gifts.by_order(self,row['id']))!=gift:raise BillingError(409,'invoice_kind_mismatch')
    oid=row['id'];amount=row['amount']
    if row['state']!='created':raise BillingError(409,'invoice_already_used')
    if row['invoice_url']:return {'url':row['invoice_url'],'order_id':oid}
  # Creating a duplicate link after an ambiguous timeout cannot grant a duplicate payment:
  # pre-checkout reserves this order for one query only.
  url=bot.api('createInvoiceLink',title='Подарок Telefy Max'if gift else'Telefy Max',description='30 дней после активации подарка.'if gift else'30 дней доступа. Без автоматического продления.',payload='max:'+oid,provider_token='',currency='XTR',prices=[{'label':'Telefy Max · 30 дней','amount':amount}])
  if not isinstance(url,str)or not url.startswith('https://t.me/$'):raise BillingError(502,'invalid_invoice_url')
  with self.db.connect()as c:self.db.execute(c,'UPDATE telefy_star_orders SET invoice_url=%s WHERE id=%s AND invoice_url IS NULL',(url,oid))
  return {'url':url,'order_id':oid}
 def precheckout(self,q):
  self.ensure();uid=(q.get('from')or{}).get('id');payload=q.get('invoice_payload','')
  if type(uid)is not int or not isinstance(payload,str)or q.get('currency')!='XTR'or type(q.get('total_amount'))is not int or not 1<=q['total_amount']<=100000 or not re.fullmatch(r'max:[0-9a-f]{48}',payload):return False
  with self.lock,self.db.connect()as c:
   row=self.db.execute(c,'SELECT * FROM telefy_star_orders WHERE id=%s'+(' FOR UPDATE'if self.db.url else''),(payload[4:],)).fetchone()
   if not row or row['telegram_id']!=uid or row['amount']!=q['total_amount']or row['created_at']<int(time.time())-900:return False
   if row['state']=='approved':return row['checkout_id']==q.get('id')
   if self.grants.mode()['beta']:return False
   if row['state']!='created':return False
   self.db.execute(c,'UPDATE telefy_star_orders SET state=%s,checkout_id=%s WHERE id=%s',('approved',q['id'],row['id']))
  return True
 def apply(self,message,refund=False):
  payment=message.get('refunded_payment'if refund else'successful_payment')or{}
  payload=payment.get('invoice_payload','');charge=payment.get('telegram_payment_charge_id')
  uid=(message.get('from')or{}).get('id')
  if type(uid)is not int or not isinstance(payload,str)or not re.fullmatch(r'max:[0-9a-f]{48}',payload)or payment.get('currency')!='XTR'or type(payment.get('total_amount'))is not int or not 1<=payment['total_amount']<=100000 or not isinstance(charge,str)or not 1<=len(charge)<=512:return False
  self.ensure()
  with self.lock,self.db.connect()as c:
   row=self.db.execute(c,'SELECT * FROM telefy_star_orders WHERE id=%s'+(' FOR UPDATE'if self.db.url else''),(payload[4:],)).fetchone()
   if not row or row['telegram_id']!=uid or row['amount']!=payment['total_amount']:return False
   if row['charge_id']:
    if row['charge_id']!=charge:return False
    if refund:self.db.execute(c,'UPDATE telefy_star_orders SET state=%s WHERE id=%s',('refunded',row['id']))
    return True
   if refund or row['state']!='approved':return False
   used=self.db.execute(c,'SELECT id FROM telefy_star_orders WHERE charge_id=%s',(charge,)).fetchone()
   if used:return False
   self.db.execute(c,'UPDATE telefy_star_orders SET state=%s,charge_id=%s,paid_at=%s WHERE id=%s',('paid',charge,int(time.time()),row['id']))
  return True
 def status(self,uid,now=None,ignore_beta=False):
  self.ensure();now=int(time.time())if now is None else int(now)
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT id,paid_at FROM telefy_star_orders WHERE telegram_id=%s AND state=%s ORDER BY paid_at,id',(uid,'paid')).fetchall()
  import max_gifts
  with self.db.connect()as c:
   rows=[r for r in rows if not self.db.execute(c,'SELECT order_id FROM telefy_max_gifts WHERE order_id=%s',(r['id'],)).fetchone()]+list(max_gifts.events(self,c,uid))
  removed=self.grants.revoked(uid,'payment');rows=[r for r in rows if r['id']not in removed]
  end=0
  for at,duration in sorted([(row['paid_at'],PERIOD)for row in rows]+self.grants.events(uid)):end=max(end,at)+duration
  if not ignore_beta and self.grants.mode()['beta']:return {'active':True,'telegram_id':uid,'beta':True,'expires_at':None,'account_expires_at':end or None,'server_time':now,'amount':0,'regular_amount':self.grants.price()['amount'],'currency':'XTR','recurring':False,'period':'beta','payments_configured':False}
  return {'active':end>now,'telegram_id':uid,'paid_periods':len(rows),'beta':False,'expires_at':end or None,'server_time':now,'amount':self.grants.price()['amount'],'currency':'XTR','recurring':False,'period':'30_days','payments_configured':configured()}

STORE=MaxStore()
def handle_precheckout(update):
 q=update.get('pre_checkout_query')
 if not isinstance(q,dict):return False
 import telefy_bot as bot
 ok=STORE.precheckout(q)
 args={'pre_checkout_query_id':q['id'],'ok':ok}
 if not ok:args['error_message']='Счёт устарел или уже использован. Открой Telefy Max и создай новый.'
 bot.api('answerPreCheckoutQuery',**args);return True
def handle_update(update):
 if handle_precheckout(update):return True
 message=update.get('message')or{}
 if message.get('successful_payment'):
  if STORE.apply(message):
   payment=message['successful_payment'];order=STORE.order(payment['invoice_payload'][4:])
   if order and order['state']=='paid':
    import max_notifications
    import max_gifts
    gift=max_gifts.by_order(STORE,order['id'])
    end=STORE.status(order['telegram_id'],ignore_beta=True)['expires_at']
    if gift:end=0
    if gift or end:max_notifications.store().queue(order['telegram_id'],payment['telegram_payment_charge_id'],end)
  return True
 if message.get('refunded_payment'):STORE.apply(message,True);return True
 command=message.get('text','').split(' ',1)[0].split('@')[0]
 if command=='/paysupport'and(message.get('chat')or{}).get('type')=='private':
  import telefy_bot as bot
  bot.api('sendMessage',chat_id=message['chat']['id'],text='По оплате Telefy Max и возвратам: @telefy_support. Приложи квитанцию Telegram.');return True
 return False

class MaxBillingMixin:
 def max_user(self,web=False):
  try:
   import profile_server
   token=SimpleCookie(self.headers.get('Cookie','')).get('telefy_user_session')
   return profile_server.DB.profile(token.value)if token else None
  except Exception:raise BillingError(503,'database_unavailable')
 def do_GET(self):
  path=urlsplit(self.path).path
  import max_gifts
  if max_gifts.route(self,path):return
  if path in('/max-checkout.html','/max-beta.html'):self.reply(410,{'error':'stars_only'});return
  if path.startswith('/api/max/stars/orders/'):
   user=self.max_user()
   if not user:self.reply(401,{'error':'login_required'});return
   order=STORE.order(path.rsplit('/',1)[-1])
   if not order or order['telegram_id']!=user['telegram_id']:self.reply(404,{'error':'order_not_found'});return
   self.reply(200,{'order_id':order['id'],'status':order['state']});return
  if path=='/api/max/status':
   try:
    user=self.max_user()
    if not user:raise BillingError(401,'login_required')
    self.reply(200,STORE.status(user['telegram_id']))
   except BillingError as e:self.reply(e.status,{'error':e.code})
   except Exception:self.reply(503,{'error':'max_status_unavailable'})
   return
  if path=='/max':self.send_response(303);self.send_header('Location','/telefy.html?screen=max');self.send_header('Content-Length','0');self.end_headers();return
  return super().do_GET()
 def do_POST(self):
  path=urlsplit(self.path).path
  import max_gifts
  if max_gifts.route(self,path):return
  if path in('/api/max/checkout-link','/api/billing/orders','/api/billing/webhook'):self.reply(410,{'error':'stars_only'});return
  if path!='/api/max/stars/invoice':return super().do_POST()
  try:
   if not self.same_origin():raise BillingError(403,'origin_rejected')
   user=self.bot_user()
   if not user:return
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<=2048 or not self.headers.get('Content-Type','').startswith('application/json'):raise BillingError(400,'invalid_request')
   body=json.loads(self.rfile.read(size))
   self.reply(200,STORE.invoice(user['telegram_id'],body.get('request_key'),body.get('terms_accepted'),body.get('expected_amount')))
  except BillingError as e:self.reply(e.status,{'error':e.code})
  except (ValueError,TypeError,AttributeError):self.reply(400,{'error':'invalid_request'})
  except Exception:self.reply(503,{'error':'stars_unavailable'})

"""One-off RUB/SBP checkout. A browser return or webhook body never grants Max."""
import os,json,time,secrets,hashlib,base64,threading,calendar,re
from decimal import Decimal,InvalidOperation
from datetime import datetime,timezone,timedelta
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import urlsplit,parse_qs,quote
from http.cookies import SimpleCookie
from user_database import UserDatabase

PRICE=9900
def beta_enabled():
    # Default launch mode: free access for every authenticated Telefy user.
    return os.environ.get('TELEFY_MAX_BETA','true').strip().lower()not in ('false','0','off')

def beta_status(now=None):
    return {'active':True,'beta':True,'expires_at':None,'server_time':int(time.time())if now is None else int(now),'amount':'0.00','regular_amount':'99.00','currency':'RUB','recurring':False,'period':'beta'}

class BillingError(Exception):
    def __init__(self,status,code):self.status,self.code=status,code
def month_after(timestamp):
    dt=datetime.fromtimestamp(timestamp,timezone(timedelta(hours=3)))
    year,month=dt.year+(dt.month==12),dt.month%12+1
    return int(dt.replace(year=year,month=month,day=min(dt.day,calendar.monthrange(year,month)[1])).timestamp())

class MaxStore:
    def __init__(self,db=None):self.db=db or UserDatabase();self.lock=threading.RLock();self.ready=False
    def ensure(self):
        with self.lock:
            if self.ready:return
            with self.db.connect()as conn:
                if self.db.url:self.db.execute(conn,'SELECT pg_advisory_xact_lock(734620107)')
                self.db.execute(conn,'CREATE TABLE IF NOT EXISTS telefy_max_orders (order_id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,request_key TEXT NOT NULL,provider_id TEXT UNIQUE,status TEXT NOT NULL,created_at BIGINT NOT NULL,paid_at BIGINT,confirmation_url TEXT,terms_url TEXT,terms_accepted_at BIGINT,UNIQUE(telegram_id,request_key))')
                self.db.execute(conn,'CREATE TABLE IF NOT EXISTS telefy_max_handoffs (token_hash TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,expires_at BIGINT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)')
            self.ready=True
    def _user_lock(self,conn,uid):
        if self.db.url:self.db.execute(conn,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s FOR UPDATE',(uid,))
    def handoff(self,uid):
        if beta_enabled():raise BillingError(409,'payments_disabled_beta')
        self.ensure();token=secrets.token_urlsafe(32);now=int(time.time())
        with self.db.connect()as c:
            self.db.execute(c,'DELETE FROM telefy_max_handoffs WHERE expires_at<%s',(now,))
            self.db.execute(c,'INSERT INTO telefy_max_handoffs VALUES(%s,%s,%s,0)',(hashlib.sha256(token.encode()).hexdigest(),uid,now+600))
        return token
    def consume(self,token):
        if not isinstance(token,str)or not 20<len(token)<100:return None
        self.ensure()
        with self.db.connect()as c:
            row=self.db.execute(c,'UPDATE telefy_max_handoffs SET consumed=1 WHERE token_hash=%s AND expires_at>%s AND consumed=0 RETURNING telegram_id',(hashlib.sha256(token.encode()).hexdigest(),int(time.time()))).fetchone()
            if not row:return None
            user=self.db.execute(c,'SELECT * FROM telefy_users WHERE telegram_id=%s',(row['telegram_id'],)).fetchone()
        return dict(user)if user else None
    def new_order(self,uid,request_key):
        if beta_enabled():raise BillingError(409,'payments_disabled_beta')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{16,80}',str(request_key)):raise BillingError(400,'invalid_request_key')
        self.ensure()
        with self.db.connect()as c:
            self._user_lock(c,uid)
            old=self.db.execute(c,'SELECT * FROM telefy_max_orders WHERE telegram_id=%s AND request_key=%s',(uid,request_key)).fetchone()
            if old:return dict(old)
            count=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_max_orders WHERE telegram_id=%s AND created_at>%s',(uid,int(time.time())-3600)).fetchone()
            if count['n']>=10:raise BillingError(429,'checkout_rate_limited')
            oid=secrets.token_hex(16)
            self.db.execute(c,'INSERT INTO telefy_max_orders(order_id,telegram_id,request_key,status,created_at,terms_url,terms_accepted_at) VALUES(%s,%s,%s,%s,%s,%s,%s)',(oid,uid,request_key,'created',int(time.time()),os.environ.get('TELEFY_MAX_TERMS_URL',''),int(time.time())))
            return dict(self.db.execute(c,'SELECT * FROM telefy_max_orders WHERE order_id=%s',(oid,)).fetchone())
    def order(self,oid,uid=None):
        self.ensure()
        with self.db.connect()as c:r=self.db.execute(c,'SELECT * FROM telefy_max_orders WHERE order_id=%s',(oid,)).fetchone()
        if not r or uid is not None and r['telegram_id']!=uid:raise BillingError(404,'order_not_found')
        return dict(r)
    def by_payment(self,pid):
        self.ensure()
        with self.db.connect()as c:r=self.db.execute(c,'SELECT * FROM telefy_max_orders WHERE provider_id=%s',(pid,)).fetchone()
        return dict(r)if r else None
    def attach(self,order,payment):
        validate(payment,order,successful=False)
        url=(payment.get('confirmation')or{}).get('confirmation_url')or ''
        host=urlsplit(url).hostname or ''
        if url and (urlsplit(url).scheme!='https'or not (host=='yoomoney.ru'or host.endswith('.yoomoney.ru')or host=='yookassa.ru')):raise BillingError(502,'invalid_confirmation_url')
        with self.db.connect()as c:
            row=self.db.execute(c,'SELECT provider_id FROM telefy_max_orders WHERE order_id=%s'+(' FOR UPDATE'if self.db.url else ''),(order['order_id'],)).fetchone()
            if row['provider_id']and row['provider_id']!=payment['id']:raise BillingError(409,'payment_conflict')
            self.db.execute(c,'UPDATE telefy_max_orders SET provider_id=%s,confirmation_url=%s WHERE order_id=%s',(payment['id'],url,order['order_id']))
    def apply(self,order,payment):
        validate(payment,order,successful=payment.get('status')=='succeeded')
        with self.lock,self.db.connect()as c:
            self._user_lock(c,order['telegram_id'])
            row=self.db.execute(c,'SELECT * FROM telefy_max_orders WHERE order_id=%s'+(' FOR UPDATE'if self.db.url else ''),(order['order_id'],)).fetchone()
            if row['provider_id']!=payment['id']:raise BillingError(409,'payment_conflict')
            if row['status']=='refunded':return
            if payment['status']=='succeeded':self.db.execute(c,'UPDATE telefy_max_orders SET status=%s,paid_at=COALESCE(paid_at,%s) WHERE order_id=%s',('paid',int(time.time()),order['order_id']))
            elif payment['status']=='canceled'and row['status']!='paid':self.db.execute(c,'UPDATE telefy_max_orders SET status=%s WHERE order_id=%s',('canceled',order['order_id']))
    def refund(self,order):
        with self.lock,self.db.connect()as c:
            self._user_lock(c,order['telegram_id'])
            self.db.execute(c,'UPDATE telefy_max_orders SET status=%s WHERE order_id=%s',('refunded',order['order_id']))
    def status(self,uid,now=None):
        if beta_enabled():return beta_status(now)
        self.ensure();now=int(time.time())if now is None else now
        with self.db.connect()as c:rows=self.db.execute(c,'SELECT paid_at FROM telefy_max_orders WHERE telegram_id=%s AND status=%s ORDER BY paid_at,order_id',(uid,'paid')).fetchall()
        end=0
        for row in rows:end=month_after(max(end,row['paid_at']))
        return {'active':end>now,'expires_at':end or None,'server_time':now,'amount':'99.00','currency':'RUB','recurring':False,'period':'calendar_month'}

def configured():return bool(os.environ.get('YOOKASSA_SHOP_ID')and os.environ.get('YOOKASSA_SECRET_KEY')and os.environ.get('TELEFY_PUBLIC_URL','').startswith('https://')and os.environ.get('TELEFY_MAX_TERMS_URL','').startswith('https://')and os.environ.get('YOOKASSA_TEST_MODE')in ('true','false'))
def test_mode():return os.environ.get('YOOKASSA_TEST_MODE','true').lower()!='false'
def provider(method,path,data=None,idempotency=None):
    if beta_enabled()and method.upper()=='POST':raise BillingError(409,'payments_disabled_beta')
    if not configured():raise BillingError(503,'payments_not_configured')
    auth=base64.b64encode((os.environ['YOOKASSA_SHOP_ID']+':'+os.environ['YOOKASSA_SECRET_KEY']).encode()).decode()
    headers={'Authorization':'Basic '+auth,'Content-Type':'application/json'}
    if idempotency:headers['Idempotence-Key']=idempotency
    req=Request('https://api.yookassa.ru/v3/'+path,data=json.dumps(data).encode()if data is not None else None,headers=headers,method=method)
    try:
        with urlopen(req,timeout=15)as r:return json.load(r)
    except (HTTPError,URLError,TimeoutError,ValueError,OSError):raise BillingError(502,'payment_provider_unavailable')from None
def validate(payment,order,successful=False):
    try:
        checks=[isinstance(payment,dict),isinstance(payment['id'],str)and bool(re.fullmatch(r'[a-zA-Z0-9-]{10,100}',payment['id'])),Decimal(payment['amount']['value'])==Decimal('99.00'),payment['amount']['currency']=='RUB',payment.get('test')is test_mode(),payment['metadata']['telefy_order_id']==order['order_id'],str(payment['metadata']['telegram_id'])==str(order['telegram_id']),payment['payment_method']['type']=='sbp',payment['status']in ('pending','waiting_for_capture','succeeded','canceled'),not successful or payment['paid']is True]
        if not all(checks):raise ValueError()
    except (ValueError,KeyError,TypeError,InvalidOperation):raise BillingError(502,'payment_verification_failed')from None

STORE=MaxStore();WEBHOOK_LOCK=threading.Lock();WEBHOOK_TIMES=[]
class MaxBillingMixin:
    def max_user(self,web=False):
        try:token=SimpleCookie(self.headers.get('Cookie','')).get('telefy_checkout_session'if web else 'telefy_user_session');return STORE.db.profile(token.value)if token else None
        except Exception:raise BillingError(503,'database_unavailable')from None
    def max_json(self):
        try:
            n=int(self.headers.get('Content-Length','0'));assert 0<n<=12000 and self.headers.get('Content-Type','').startswith('application/json')
            body=json.loads(self.rfile.read(n));assert isinstance(body,dict);return body
        except (ValueError,AssertionError):raise BillingError(400,'invalid_request')from None
    def max_reply_html(self,html):
        body=html.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        route=urlsplit(self.path)
        try:
            if route.path=='/max':
                if beta_enabled():
                    from pathlib import Path
                    self.max_reply_html(Path(__file__).with_name('max-beta.html').read_text(encoding='utf-8'));return
                token=parse_qs(route.query).get('handoff',[''])[0]
                if token:
                    user=STORE.consume(token)
                    if not user:raise BillingError(401,'checkout_link_expired')
                    session,_=STORE.db.login(user)
                    theme=parse_qs(route.query).get('theme',[''])[0];destination='/max'+('?theme='+theme if theme in ('light','dark')else '')
                    self.send_response(303);self.send_header('Location',destination);self.send_header('Set-Cookie',f'telefy_checkout_session={session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length','0');self.end_headers();return
                from pathlib import Path
                self.max_reply_html(Path(__file__).with_name('max-checkout.html').read_text(encoding='utf-8'));return
            if route.path=='/api/max/status':
                user=self.max_user(web=parse_qs(route.query).get('web',['0'])[0]=='1')
                if not user:raise BillingError(401,'login_required')
                self.reply(200,{**STORE.status(user['telegram_id']),'payments_configured':False if beta_enabled()else configured(),'terms_url':'' if beta_enabled()else os.environ.get('TELEFY_MAX_TERMS_URL','')});return
            if route.path.startswith('/api/billing/orders/'):
                if beta_enabled():raise BillingError(409,'payments_disabled_beta')
                user=self.max_user(web=True)
                if not user:raise BillingError(401,'login_required')
                order=STORE.order(route.path.rsplit('/',1)[-1],user['telegram_id'])
                if order['provider_id']and order['status']not in ('paid','canceled','refunded'):
                    payment=provider('GET','payments/'+quote(order['provider_id'],safe=''));STORE.apply(order,payment);order=STORE.order(order['order_id'],user['telegram_id'])
                self.reply(200,{'order_id':order['order_id'],'status':order['status'],'max':STORE.status(user['telegram_id'])});return
        except BillingError as e:self.reply(e.status,{'error':e.code});return
        except Exception:self.reply(503,{'error':'billing_unavailable'});return
        return super().do_GET()
    def do_POST(self):
        path=urlsplit(self.path).path
        try:
            if path=='/api/billing/webhook':
                with WEBHOOK_LOCK:
                    now=time.monotonic();WEBHOOK_TIMES[:]=[x for x in WEBHOOK_TIMES if x>now-60]
                    if len(WEBHOOK_TIMES)>=120:raise BillingError(429,'try_later')
                    WEBHOOK_TIMES.append(now)
                body=self.max_json();obj=body.get('object')or {};event=body.get('event')
                if event in ('payment.succeeded','payment.canceled'):
                    order=STORE.by_payment(str(obj.get('id','')))
                    if order:
                        if order['status']not in ('paid','refunded')or event=='payment.canceled':STORE.apply(order,provider('GET','payments/'+quote(order['provider_id'],safe='')))
                elif event=='refund.succeeded':
                    order=STORE.by_payment(str(obj.get('payment_id','')))
                    if order:
                        rid=str(obj.get('id',''))
                        if not re.fullmatch(r'[a-zA-Z0-9-]{10,100}',rid):raise BillingError(400,'invalid_refund')
                        refund=provider('GET','refunds/'+rid)
                        try:amount=Decimal((refund.get('amount')or{})['value'])
                        except (KeyError,TypeError,InvalidOperation):raise BillingError(502,'refund_verification_failed')from None
                        if refund.get('id')!=rid or refund.get('payment_id')!=order['provider_id']or refund.get('status')!='succeeded'or (refund.get('amount')or{}).get('currency')!='RUB'or not Decimal('0')<amount<=Decimal('99.00'):raise BillingError(502,'refund_verification_failed')
                        if amount==Decimal('99.00'):STORE.refund(order)
                        else:print('Telefy Max partial refund: manual review for order '+order['order_id'],flush=True)
                self.reply(200,{'ok':True});return
            if path not in ('/api/max/checkout-link','/api/billing/orders'):return super().do_POST()
            if beta_enabled():raise BillingError(409,'payments_disabled_beta')
            if not self.same_origin():raise BillingError(403,'origin_rejected')
            user=self.max_user(web=path=='/api/billing/orders')
            if not user:raise BillingError(401,'login_required')
            if not configured():raise BillingError(503,'payments_not_configured')
            if path=='/api/max/checkout-link':
                token=STORE.handoff(user['telegram_id']);theme=parse_qs(urlsplit(self.path).query).get('theme',[''])[0];theme='&theme='+theme if theme in ('light','dark')else '';self.reply(200,{'url':os.environ['TELEFY_PUBLIC_URL'].rstrip('/')+'/max?handoff='+token+theme});return
            body=self.max_json()
            if body.get('terms_accepted')is not True:raise BillingError(400,'terms_required')
            order=STORE.new_order(user['telegram_id'],body.get('request_key'))
            if not order['provider_id']:
                payment=provider('POST','payments',{'amount':{'value':'99.00','currency':'RUB'},'capture':True,'payment_method_data':{'type':'sbp'},'save_payment_method':False,'confirmation':{'type':'redirect','return_url':os.environ['TELEFY_PUBLIC_URL'].rstrip('/')+'/max?order='+order['order_id']},'description':'Telefy Max — один календарный месяц','metadata':{'telefy_order_id':order['order_id'],'telegram_id':str(user['telegram_id'])}},order['order_id'])
                STORE.attach(order,payment);STORE.apply(STORE.order(order['order_id']),payment)
            order=STORE.order(order['order_id']);self.reply(200,{'order_id':order['order_id'],'confirmation_url':order['confirmation_url'],'status':order['status']});return
        except BillingError as e:self.reply(e.status,{'error':e.code})
        except Exception:self.reply(503,{'error':'billing_unavailable'})

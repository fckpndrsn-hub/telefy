"""Adds verified Telegram profiles to the existing server without replacing its routes."""
import os,json,time,threading
from http.cookies import SimpleCookie,CookieError
from urllib.parse import urlsplit
from http.server import ThreadingHTTPServer
import server as base
from max_billing import MaxBillingMixin
from library_store import LibraryMixin
from telegram_auth import verify_init_data,AuthError
from user_database import UserDatabase,DatabaseUnavailable

DB=UserDatabase()
LIMITS={};LIMIT_LOCK=threading.Lock()
BOOT='''<script src="https://telegram.org/js/telegram-web-app.js"></script><script>
(async()=>{const tg=window.Telegram?.WebApp;if(!tg?.initData)return;
document.querySelector('form')?.remove();const status=document.getElementById('s');status.textContent='Подключаем профиль Telegram…';
try{const r=await fetch('/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});
if(!r.ok){status.textContent=r.status===403?'Подпишись на @telefy_news и открой приложение снова через бота.':'Не удалось подключить профиль. Открой приложение заново; если ошибка повторяется, напиши @telefy_support.';return;}
location.replace('/telefy.html'+location.search);}catch(_){status.textContent='Не удалось подключиться. Попробуй открыть приложение снова.';}})();</script>'''

class Handler(LibraryMixin,MaxBillingMixin,base.Handler):
    def cookie_token(self):
        try:return SimpleCookie(self.headers.get('Cookie',''))['telefy_user_session'].value
        except (KeyError,ValueError,CookieError):return ''
    def membership(self,uid):
        bot=getattr(base,'tbot',None)
        return not bot or not bot.enabled() or bot.subscribed(uid,cached=True)
    def authenticated(self):
        token=self.cookie_token()
        if token:
            try:
                profile=DB.profile(token)
                if profile and self.membership(profile['telegram_id']):return True
            except Exception:pass
        return super().authenticated()
    def bootstrap(self):
        body=(base.LOGIN+BOOT).encode()
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        route=urlsplit(self.path).path
        if route=='/health':
            self.reply(200,{'ok':True,'build':'telefy-profile-db-v1','library_build':'telefy-library-auto-v2','max_build':'telefy-free-beta-v1','music_build':'telefy-oauth-db-v4-20261116','recommendations_period_hours':6,'oauth_storage':dict(getattr(base.sc,'OAUTH_STORAGE',{})),'soundcloud_limits':dict(getattr(base.sc,'RATE_WINDOWS',{})),'soundcloud_last_rate_limit':dict(getattr(base.sc,'LAST_RATE_LIMIT',{})),'soundcloud_retry_after':max(0,int(getattr(base.sc,'SOUNDCLOUD_RETRY_AT',0)-time.time())),'database_configured':bool(os.environ.get('DATABASE_URL')),'telegram_configured':bool(os.environ.get('BOT_TOKEN'))});return
        if route=='/api/me/taste':
            try:
                user=DB.profile(self.cookie_token())
                if not user:self.reply(401,{'error':'login_required'});return
                self.reply(200,{'history':DB.taste(user['telegram_id'])})
            except Exception:self.reply(503,{'error':'database_unavailable'})
            return
        if route=='/api/me':
            try:profile=DB.profile(self.cookie_token())
            except Exception:self.reply(503,{'error':'database_unavailable'});return
            if not profile:self.reply(401,{'error':'login_required'});return
            self.reply(200,{'user':profile});return
        if route in ('/','/telefy.html') and not self.authenticated():self.bootstrap();return
        return super().do_GET()
    def same_origin(self):
        origin=self.headers.get('Origin','');host=self.headers.get('Host','')
        allowed={'https://'+host}
        if host.startswith(('127.0.0.1:','localhost:')):allowed.add('http://'+host)
        return origin in allowed
    def do_POST(self):
        route=urlsplit(self.path).path
        if route=='/api/me/taste':
            if not self.same_origin():self.reply(403,{'error':'origin_rejected'});return
            try:
                user=DB.profile(self.cookie_token())
                if not user:self.reply(401,{'error':'login_required'});return
            except Exception:self.reply(503,{'error':'database_unavailable'});return
            try:
                import re
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=12000 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
                record=json.loads(self.rfile.read(n))
                if not isinstance(record,dict):raise ValueError()
                for k,size in [('eventId',64),('key',500),('artist',200),('genre',100)]:
                    if not isinstance(record.get(k),str) or len(record[k])>size:raise ValueError()
                if not re.fullmatch(r'[a-zA-Z0-9_-]{8,64}',record['eventId']):raise ValueError()
                if not isinstance(record.get('at'),int) or not int(time.time()*1000)-90*86400000<=record['at']<=int(time.time()*1000)+300000:raise ValueError()
                modes=record.get('modes')
                if not isinstance(modes,list) or len(modes)>5 or any(m not in ('all','energy','night','uncensored','underground')for m in modes):raise ValueError()
                clean={k:record[k]for k in ('eventId','key','artist','genre','at','modes')}
                clean['urn']=str(record.get('urn') or '')[:100]
            except (ValueError,TypeError,KeyError):self.reply(400,{'error':'invalid_history'});return
            try:self.reply(200,{'history':DB.record_taste(user['telegram_id'],clean)})
            except Exception:self.reply(503,{'error':'database_unavailable'})
            return
        if route not in ('/api/auth/telegram','/api/auth/logout'):return super().do_POST()
        if not self.same_origin():self.reply(403,{'error':'origin_rejected'});return
        if route=='/api/auth/logout':
            try:DB.logout(self.cookie_token())
            except Exception:self.reply(503,{'error':'database_unavailable'});return
            self.session_reply({'ok':True},'',0);return
        now=time.monotonic();ip=self.client_address[0]
        with LIMIT_LOCK:
            if len(LIMITS)>10000:LIMITS.clear()
            times=[t for t in LIMITS.get(ip,[]) if t>now-60]
            if len(times)>=40:self.reply(429,{'error':'try_later'});return
            LIMITS[ip]=times+[now]
        if not os.environ.get('BOT_TOKEN'):self.reply(503,{'error':'bot_not_configured'});return
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=20000 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
            data=json.loads(self.rfile.read(n));raw=data.get('initData')
        except (ValueError,TypeError,AttributeError):self.reply(400,{'error':'invalid_request'});return
        try:user=verify_init_data(raw,os.environ['BOT_TOKEN'])
        except AuthError:self.reply(401,{'error':'invalid_telegram_data'});return
        try:
            if not self.membership(user['telegram_id']):self.reply(403,{'error':'subscription_required'});return
        except Exception:self.reply(503,{'error':'verification_unavailable'});return
        try:token,profile=DB.login(user)
        except Exception:self.reply(503,{'error':'database_unavailable'});return
        self.session_reply({'user':profile},token,604800)
    def session_reply(self,data,token,age):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
        self.send_header('Set-Cookie',f'telefy_user_session={token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={age}')
        self.end_headers();self.wfile.write(body)

if __name__=='__main__':
    # Do not spend search/stream quota on every deploy just to probe readiness.
    bot=getattr(base,'tbot',None)
    if bot:threading.Thread(target=bot.setup,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','10000'))),Handler).serve_forever()

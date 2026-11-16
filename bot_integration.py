"""Routes the bot into the existing verified profiles, libraries and free Max."""
import json,time,hmac,threading
from urllib.parse import urlsplit,parse_qs,quote
from urllib.request import urlopen
import telefy_bot as bot

AVATARS={};AVATAR_LOCK=threading.Lock()
def avatar(uid):
    with AVATAR_LOCK:cached=AVATARS.get(uid)
    if cached and cached[0]>time.time():return cached[1:]
    try:
        photos=bot.api('getUserProfilePhotos',user_id=uid,limit=1).get('photos')or[]
        if not photos:return None
        file_id=photos[0][-1]['file_id'];path=bot.api('getFile',file_id=file_id)['file_path']
        if not isinstance(path,str)or path.startswith('/')or'..'in path or':'in path:raise ValueError()
        with urlopen('https://api.telegram.org/file/bot'+bot.TOKEN+'/'+quote(path,safe='/'),timeout=12)as response:data=response.read(2097153)
        if len(data)>2097152:raise ValueError()
        if data.startswith(b'\xff\xd8'):mime='image/jpeg'
        elif data.startswith(b'\x89PNG\r\n\x1a\n'):mime='image/png'
        elif data.startswith(b'RIFF')and data[8:12]==b'WEBP':mime='image/webp'
        else:raise ValueError()
        with AVATAR_LOCK:
            if len(AVATARS)>1000:AVATARS.clear()
            AVATARS[uid]=(time.time()+300,data,mime)
        return data,mime
    except Exception:return None

class BotMixin:
    def bot_html(self,body,status=200):
        data=body.encode();self.send_response(status);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def bot_user(self,allow_admin=False,web=False):
        import profile_server
        try:
            user=self.max_user(web=True)if web else profile_server.DB.profile(self.cookie_token())
            if user:
                if not self.membership(user['telegram_id']):self.reply(403,{'error':'subscription_required'});return False
                return user
            if allow_admin and super().authenticated():return True
            self.reply(401,{'error':'login_required'});return False
        except Exception:self.reply(503,{'error':'verification_unavailable'});return False
    def do_GET(self):
        route=urlsplit(self.path);path=route.path
        if path=='/api/me/reminders':
            user=self.bot_user()
            if not user:return
            try:
                import bot_reminders
                self.reply(200,bot_reminders.store().prefs(user['telegram_id']))
            except Exception:self.reply(503,{'error':'reminders_unavailable'})
            return
        if path in('/','/telefy.html'):
            if not self.authenticated():self.bootstrap();return
            from pathlib import Path
            import profile_server
            page=Path(profile_server.base.WEB)/'telefy.html'
            if not page.is_file():self.reply(404,{'error':'not_found'});return
            self.bot_html(page.read_text(encoding='utf-8'));return
        if path=='/bot/launch':
            if not bot.enabled():self.bot_html(bot.gate_html('configuration_required'),503);return
            ticket=parse_qs(route.query).get('ticket',[''])[0]
            try:
                p=bot.decode(ticket,allow_expired=True)
                import profile_server
                current=profile_server.DB.profile(self.cookie_token())
                if not bot.subscribed(p['uid']):self.bot_html(bot.gate_html());return
                # A consumed button remains useful on its original authenticated device.
                if current and current['telegram_id']==p['uid']:session=None
                else:
                    bot.decode(ticket)
                    result=bot.store().exchange(ticket,p['uid'])
                    if not result:raise bot.AccessDenied('used_launch')
                    session,_=result
                self.send_response(303);self.send_header('Location','/telefy.html?screen='+p['screen'])
                if session:self.send_header('Set-Cookie',f'telefy_user_session={session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800')
                self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Length','0');self.end_headers();return
            except bot.AccessDenied:self.bot_html(bot.gate_html('invalid_launch'),401);return
            except Exception:self.bot_html(bot.gate_html('verification_unavailable'),503);return
        protected=path in('/api/me','/api/me/taste','/api/me/library','/api/me/avatar','/api/max/status')or path.startswith('/api/soundcloud/')
        if protected:
            user=self.bot_user(allow_admin=path.startswith('/api/soundcloud/'),web=path=='/api/max/status'and parse_qs(route.query).get('web',['0'])[0]=='1')
            if not user:return
            if path=='/api/me/avatar':
                result=avatar(user['telegram_id'])
                if not result:self.reply(404,{'error':'avatar_unavailable'});return
                data,mime=result;self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','private, no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        return super().do_GET()
    def do_POST(self):
        path=urlsplit(self.path).path
        if path=='/internal/reminders/tick':
            expected='Bearer '+bot.secret('reminders-tick-v1').hex()
            if not bot.enabled()or not hmac.compare_digest(self.headers.get('Authorization','').encode(),expected.encode()):self.reply(403,{'error':'tick_rejected'});return
            if bot.DIAGNOSTIC.get('state')!='ready':self.reply(503,{'error':'bot_not_ready'});return
            try:
                import bot_reminders
                count=0
                end=time.monotonic()+45
                for _ in range(50):
                    if time.monotonic()>=end:break
                    import bot_posts
                    reminder=bot_reminders.run_one();post=bot_posts.run_one()
                    if not reminder and not post:break
                    count+=1;time.sleep(.25)
                self.reply(200,{'ok':True,'processed':count})
            except Exception:self.reply(503,{'error':'reminders_unavailable'})
            return
        if path in('/api/me/activity','/api/me/reminders'):
            if not self.same_origin():self.reply(403,{'error':'origin_rejected'});return
            user=self.bot_user()
            if not user:return
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=512 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
                data=json.loads(self.rfile.read(n))
                if not isinstance(data,dict):raise ValueError()
                import bot_reminders
                if path=='/api/me/activity':bot_reminders.store().activity(user['telegram_id']);self.reply(200,{'ok':True})
                else:self.reply(200,bot_reminders.store().toggle(user['telegram_id'],data.get('enabled')))
            except (ValueError,TypeError):self.reply(400,{'error':'invalid_request'})
            except Exception:self.reply(503,{'error':'reminders_unavailable'})
            return
        if path=='/bot/webhook':
            if not bot.enabled()or not hmac.compare_digest(self.headers.get('X-Telegram-Bot-Api-Secret-Token','').encode(),bot.webhook_secret().encode()):self.reply(403,{'error':'webhook_rejected'});return
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=65536 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
                update=json.loads(self.rfile.read(n));bot.submit(update)
            except (ValueError,TypeError,UnicodeError):self.reply(400,{'error':'invalid_update'});return
            except Exception:self.reply(503,{'error':'bot_database_unavailable'});return
            self.reply(200,{'ok':True});return
        if path in('/api/me/taste','/api/me/library','/api/me/library/import')or path.startswith('/api/soundcloud/'):
            if not self.bot_user(allow_admin=path.startswith('/api/soundcloud/')):return
        return super().do_POST()

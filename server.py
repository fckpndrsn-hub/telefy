"""Private API bridge. Does not proxy or store audio."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
import json, os, secrets, threading, time
from urllib.parse import urlsplit, parse_qs
import soundcloud_api as sc

KEY=os.environ.get('TELEFY_BRIDGE_TOKEN','')
if len(KEY)<32: raise SystemExit('Set TELEFY_BRIDGE_TOKEN to at least 32 random characters')
quota=[]
lock=threading.Lock()
SESSION=secrets.token_urlsafe(48)
WEB=Path(__file__).resolve().parent/'web'
diagnostic={'state':'checking'}
LOGIN='''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telefy · Тест</title><style>body{font:16px system-ui;background:#f2f2f7;color:#17212b;max-width:400px;margin:15vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border-radius:12px;border:1px solid #ddd;font:inherit}button{background:#2aabee;color:white;border:0}p{line-height:1.5}</style><h1>Telefy</h1><p>Вход в тестовую сборку. Вставь TELEFY_BRIDGE_TOKEN — секрет связи из Render.</p><form id="f"><input id="key" type="password" required autocomplete="off" aria-label="Токен доступа"><button>Открыть Telefy</button></form><p id="s" role="status"></p><script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const k=document.getElementById('key'),s=document.getElementById('s');s.textContent='Подключаем…';try{const r=await fetch('/session',{method:'POST',headers:{Authorization:'Bearer '+k.value}});k.value='';if(!r.ok)throw Error('Проверь токен доступа.');location.href='/telefy.html';}catch(e){s.textContent=e.message;}};</script></html>'''

def check_soundcloud():
    try:
        result=sc.search('PHARAOH',0,1)
        diagnostic.update(state='catalog_ok',tracks=len(result['tracks']))
        if result['tracks']:
            stream=sc.stream({'soundcloudUrn':result['tracks'][0]['soundcloudUrn']})
            diagnostic.update(state='stream_ready',protocol=stream['protocol'])
    except sc.APIError as error:diagnostic.update(state='error',error=error.code)
    except Exception:diagnostic.update(state='error',error='check_failed')

class Handler(SimpleHTTPRequestHandler):
    def authenticated(self):
        if secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+KEY):return True
        try:
            cookies=SimpleCookie(self.headers.get('Cookie',''))
            return 'telefy_session' in cookies and secrets.compare_digest(cookies['telefy_session'].value,SESSION)
        except Exception:return False
    def login_page(self):
        body=LOGIN.encode('utf-8');self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def reply(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def authorized(self):
        if not self.authenticated():
            self.reply(401,{'error':'bridge_unauthorized'});return False
        with lock:
            now=time.monotonic();quota[:]=[t for t in quota if t>now-60]
            if len(quota)>=90:self.reply(429,{'error':'bridge_rate_limited'});return False
            quota.append(now)
        return True
    def do_GET(self):
        route=urlsplit(self.path)
        if route.path=='/health':self.reply(200,{'ok':True,'soundcloud':dict(diagnostic)});return
        if route.path in ('/','/telefy.html') or route.path.startswith('/assets/'):
            if not self.authenticated():self.login_page();return
            path=(WEB/route.path.lstrip('/')).resolve() if route.path!='/' else WEB/'telefy.html'
            if not path.is_relative_to(WEB) or not path.is_file():self.reply(404,{'error':'not_found'});return
            self.path='/'+str(path.relative_to(WEB)).replace('\\','/')
            self.directory=str(WEB)
            super().do_GET();return
        if not self.authorized():return
        try:
            if route.path=='/api/soundcloud/status':self.reply(200,{'configured':sc.configured()})
            elif route.path=='/api/soundcloud/search':
                q=parse_qs(route.query)
                self.reply(200,sc.search(q.get('q',[''])[0],q.get('offset',[0])[0],q.get('limit',[25])[0]))
            else:self.reply(404,{'error':'not_found'})
        except sc.APIError as e:self.reply(e.status,{'error':e.code})
        except Exception:self.reply(502,{'error':'bridge_unavailable'})
    def do_POST(self):
        if self.path=='/session':
            if self.headers.get('Origin')!='https://'+self.headers.get('Host',''):
                self.reply(403,{'error':'origin_rejected'});return
            if not self.authorized():return
            self.send_response(204)
            self.send_header('Set-Cookie',f'telefy_session={SESSION}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800')
            self.send_header('Cache-Control','no-store');self.end_headers();return
        if not self.authorized():return
        if self.path!='/api/soundcloud/stream':self.reply(404,{'error':'not_found'});return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=4096:raise ValueError()
            data=json.loads(self.rfile.read(length))
        except (ValueError,UnicodeError):self.reply(400,{'error':'invalid_request'});return
        try:self.reply(200,sc.stream(data))
        except sc.APIError as e:self.reply(e.status,{'error':e.code})
        except Exception:self.reply(502,{'error':'bridge_unavailable'})
    def log_message(self,*args):pass

if __name__=='__main__':
    threading.Thread(target=check_soundcloud,daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','10000'))),Handler).serve_forever()

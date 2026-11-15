"""Private API bridge. Does not proxy or store audio."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, secrets, threading, time
from urllib.parse import urlsplit, parse_qs
import soundcloud_api as sc

KEY=os.environ.get('TELEFY_BRIDGE_TOKEN','')
if len(KEY)<32: raise SystemExit('Set TELEFY_BRIDGE_TOKEN to at least 32 random characters')
quota=[]
lock=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def authorized(self):
        if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+KEY):
            self.reply(401,{'error':'bridge_unauthorized'});return False
        with lock:
            now=time.monotonic();quota[:]=[t for t in quota if t>now-60]
            if len(quota)>=90:self.reply(429,{'error':'bridge_rate_limited'});return False
            quota.append(now)
        return True
    def do_GET(self):
        route=urlsplit(self.path)
        if route.path=='/health':self.reply(200,{'ok':True});return
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

ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','10000'))),Handler).serve_forever()

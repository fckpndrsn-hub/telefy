"""Account-owned library. Compare-and-swap prevents stale device overwrites."""
import json,re,threading,time
from urllib.parse import urlsplit
from user_database import DatabaseUnavailable

class LibraryError(Exception):
    def __init__(self,status,error):self.status=status;self.error=error

def text(value,limit,required=False):
    if not isinstance(value,str) or len(value)>limit or (required and not value.strip()):raise LibraryError(400,'invalid_library')
    return value

def track(value):
    if not isinstance(value,dict):raise LibraryError(400,'invalid_library')
    clean={k:text(value.get(k,''),n,k in ('key','title','artist')) for k,n in [('key',500),('title',300),('artist',300),('primaryArtist',300),('album',300),('soundcloudUrn',120),('coverImg',2000)]}
    if clean['coverImg'] and not clean['coverImg'].startswith('https://'):clean['coverImg']=''
    duration=value.get('duration',0)
    if type(duration)not in (int,float) or not 0<=duration<=86400:raise LibraryError(400,'invalid_library')
    clean['duration']=duration
    return clean

def library(value):
    if not isinstance(value,dict):raise LibraryError(400,'invalid_library')
    likes=value.get('likes');playlists=value.get('playlists')
    if not isinstance(likes,list) or len(likes)>2000 or not isinstance(playlists,list) or len(playlists)>100:raise LibraryError(400,'library_too_large')
    likes=[track(t) for t in likes];seen=set();result=[]
    if len({t['key']for t in likes})!=len(likes):raise LibraryError(400,'duplicate_track')
    for p in playlists:
        if not isinstance(p,dict):raise LibraryError(400,'invalid_playlist')
        pid=text(p.get('id'),100,True)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+',pid) or pid in seen:raise LibraryError(400,'invalid_playlist')
        seen.add(pid)
        items=p.get('tracks')
        if not isinstance(items,list)or len(items)>500:raise LibraryError(400,'playlist_too_large')
        items=[track(t)for t in items]
        if len({t['key']for t in items})!=len(items):raise LibraryError(400,'duplicate_track')
        cover=text(p.get('coverImg',''),2000)
        result.append({'id':pid,'title':text(p.get('title'),150,True),'subtitle':text(p.get('subtitle',''),300),'coverImg':cover if cover.startswith('https://')else '', 'cover':text(p.get('cover','#2AABEE'),40),'personal':p.get('personal')is True,'tracks':items})
    if sum(p['personal']for p in result)>1:raise LibraryError(400,'duplicate_personal_playlist')
    return {'likes':likes,'playlists':result}

class LibraryStore:
    def __init__(self,db):self.db=db;self.lock=threading.Lock();self.initialized=False
    def ensure(self):
        self.db.ensure()
        with self.lock:
            if self.initialized:return
            with self.db.connect()as c:
                if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620109)')
                self.db.execute(c,'''CREATE TABLE IF NOT EXISTS telefy_user_libraries (
                  telegram_id BIGINT PRIMARY KEY REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,
                  revision BIGINT NOT NULL, library_json TEXT NOT NULL, updated_at BIGINT NOT NULL)''')
            self.initialized=True
    def read(self,uid):
        self.ensure()
        with self.db.connect()as c:return self._read(c,uid)
    def _read(self,c,uid):
        row=self.db.execute(c,'SELECT revision,library_json FROM telefy_user_libraries WHERE telegram_id=%s',(uid,)).fetchone()
        return {'revision':row['revision'],'library':json.loads(row['library_json'])}if row else {'revision':0,'library':{'likes':[],'playlists':[]}}
    def write(self,uid,revision,value,can_edit):
        value=library(value);self.ensure()
        if type(revision)is not int or revision<0:raise LibraryError(400,'invalid_revision')
        with self.db.connect()as c:
            # Account row exists even before the first library write.
            self.db.execute(c,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s'+(' FOR UPDATE'if self.db.url else ''),(uid,))
            current=self._read(c,uid)
            if current['revision']!=revision:raise LibraryError(409,'library_changed')
            previous={p['id']:p for p in current['library']['playlists']}
            # Reads, likes and deletion remain available after Max expires.
            if not can_edit and any(previous.get(p['id'])!=p for p in value['playlists']):raise LibraryError(403,'max_required')
            if value==current['library']:return current
            revision+=1
            self.db.execute(c,'''INSERT INTO telefy_user_libraries VALUES(%s,%s,%s,%s)
              ON CONFLICT(telegram_id) DO UPDATE SET revision=excluded.revision,library_json=excluded.library_json,updated_at=excluded.updated_at''',(uid,revision,json.dumps(value,ensure_ascii=False),int(time.time())))
            return {'revision':revision,'library':value}

class LibraryMixin:
    def library_context(self):
        # Resolve dynamically so tests and the profile server share the same DB.
        import profile_server
        db=profile_server.DB
        user=db.profile(self.cookie_token())
        if not user:raise LibraryError(401,'login_required')
        if not getattr(db,'library_store',None):
            with LIBRARY_LOCK:
                if not getattr(db,'library_store',None):db.library_store=LibraryStore(db)
        return user['telegram_id'],db.library_store
    def do_GET(self):
        if urlsplit(self.path).path!='/api/me/library':return super().do_GET()
        try:
            uid,store=self.library_context();self.reply(200,store.read(uid))
        except LibraryError as e:self.reply(e.status,{'error':e.error})
        except Exception:self.reply(503,{'error':'database_unavailable'})
    def do_POST(self):
        if urlsplit(self.path).path!='/api/me/library':return super().do_POST()
        if not self.same_origin():self.reply(403,{'error':'origin_rejected'});return
        try:
            uid,store=self.library_context()
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=3000000 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
                body=json.loads(self.rfile.read(n))
                if not isinstance(body,dict):raise ValueError()
            except (ValueError,TypeError):raise LibraryError(400,'invalid_request')from None
            import max_billing
            can_edit=max_billing.STORE.status(uid)['active']
            self.reply(200,store.write(uid,body.get('revision'),body.get('library'),can_edit))
        except LibraryError as e:self.reply(e.status,{'error':e.error})
        except Exception:self.reply(503,{'error':'database_unavailable'})

LIBRARY_LOCK=threading.Lock()

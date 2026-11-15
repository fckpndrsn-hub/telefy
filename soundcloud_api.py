"""Official SoundCloud public API. Credentials and tokens never enter frontend code."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote, urlsplit, urljoin, parse_qs
from urllib.request import Request, urlopen, HTTPRedirectHandler, build_opener

DATA = Path(os.environ.get('TELEFY_PRIVATE_DIR', str(Path(__file__).resolve().parent.parent / '.telefy-private')))
LOCK = threading.RLock()
SEARCH_CACHE = {}

class APIError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code

def read_json(path):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError): return {}

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    ignore = path.parent / '.gitignore'
    if not ignore.exists(): ignore.write_text('*\n!.gitignore\n', encoding='utf-8')
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data), encoding='utf-8')
    temp.replace(path)

def settings():
    saved = read_json(DATA / 'soundcloud.json')
    return {'client_id':os.environ.get('SOUNDCLOUD_CLIENT_ID') or saved.get('client_id',''),
            'client_secret':os.environ.get('SOUNDCLOUD_CLIENT_SECRET') or saved.get('client_secret','')}

def configured():
    cfg = settings()
    return bool(cfg['client_id'] and cfg['client_secret'])

def json_request(url, data=None, headers=None):
    request = Request(url, data=data, headers={'Accept':'application/json; charset=utf-8', **(headers or {})})
    try:
        with urlopen(request, timeout=18) as response: return json.load(response)
    except HTTPError as error:
        if error.code == 403:
            body = error.read(6000).decode('utf-8','replace')
            if 'block access from your country' in body.lower():
                raise APIError(403,'soundcloud_geo_blocked') from None
        code = {400:'soundcloud_bad_request',401:'soundcloud_auth_failed',403:'soundcloud_forbidden',404:'soundcloud_not_found',429:'soundcloud_rate_limited'}.get(error.code,'soundcloud_unavailable')
        raise APIError(error.code if error.code in (400,401,403,404,429) else 502, code) from None
    except (URLError, TimeoutError, ValueError, OSError):
        raise APIError(502, 'soundcloud_unavailable') from None

def access_token(invalidate=None, credentials=None):
    with LOCK:
        cfg = credentials or settings()
        if not cfg['client_id'] or not cfg['client_secret']:
            raise APIError(503,'soundcloud_not_configured')
        fingerprint = hashlib.sha256((cfg['client_id']+'\0'+cfg['client_secret']).encode()).hexdigest()
        path = DATA / 'soundcloud-session.json'
        session = read_json(path)
        if session.get('fingerprint') != fingerprint: session = {}
        if session.get('access_token') and session.get('expires_at',0) > time.time()+60 and session['access_token'] != invalidate:
            return session['access_token']
        if session.get('refresh_token'):
            try:
                token = json_request('https://secure.soundcloud.com/oauth/token',
                    urlencode({'grant_type':'refresh_token', **cfg,'refresh_token':session['refresh_token']}).encode(),
                    {'Content-Type':'application/x-www-form-urlencoded'})
            except APIError as error:
                if error.status not in (400,401,403): raise
                token = None
        else: token = None
        if token is None:
            basic = base64.b64encode((cfg['client_id']+':'+cfg['client_secret']).encode()).decode()
            token = json_request('https://secure.soundcloud.com/oauth/token',
                b'grant_type=client_credentials', {'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+basic})
        if not token.get('access_token'): raise APIError(502,'soundcloud_invalid_token')
        write_json(path, {'fingerprint':fingerprint, **token,'expires_at':time.time()+int(token.get('expires_in',3600))})
        return token['access_token']

def connect(data):
    if not isinstance(data,dict): raise APIError(400,'invalid_credentials')
    cfg = {k:str(data.get(k) or '').strip() for k in ('client_id','client_secret')}
    if not all(cfg.values()) or any(len(v)>1024 for v in cfg.values()):
        raise APIError(400,'invalid_credentials')
    with LOCK:
        access_token(credentials=cfg)
        write_json(DATA/'soundcloud.json',cfg)
        SEARCH_CACHE.clear()
    try:
        search('PHARAOH',0,1)
        return {'connected':True,'catalogAvailable':True}
    except APIError as error:
        return {'connected':True,'catalogAvailable':False,'catalogError':error.code}

def api(path, params=None):
    token = access_token()
    url = 'https://api.soundcloud.com'+path+('?' + urlencode(params) if params else '')
    try: return json_request(url, headers={'Authorization':'OAuth '+token})
    except APIError as error:
        if error.status != 401: raise
        token = access_token(invalidate=token)
        return json_request(url, headers={'Authorization':'OAuth '+token})

def track_urn(value):
    value = str(value or '')
    if value.isdigit(): value = 'soundcloud:tracks:'+value
    if not re.fullmatch(r'soundcloud:tracks:\d+',value): raise APIError(400,'invalid_track')
    return value

def safe_url(value):
    return value if isinstance(value,str) and value.startswith('https://') else ''

def normalize_track(raw):
    urn = track_urn(raw.get('urn') or raw.get('id'))
    user = raw.get('user') or {}
    title = str(raw.get('title') or '').strip()
    artist = str(raw.get('metadata_artist') or '').strip()
    if not artist:
        parts = re.split(r'\s+[-–—]\s+',title,maxsplit=1)
        if len(parts)==2 and 0<len(parts[0])<80: artist,title = parts
        else: artist = str(user.get('username') or 'Unknown artist')
    artwork = safe_url(raw.get('artwork_url'))
    if artwork: artwork = artwork.replace('-large.','-t500x500.')
    return {'soundcloudUrn':urn, 'soundcloudUrl':safe_url(raw.get('permalink_url')),
            'uploader':str(user.get('username') or ''), 'uploaderUrl':safe_url(user.get('permalink_url')),
            'title':title, 'artist':artist, 'primaryArtist':artist, 'album':'',
            'duration':max(1, float(raw.get('duration') or 0)/1000), 'coverImg':artwork or safe_url(user.get('avatar_url')),
            'artistImg':safe_url(user.get('avatar_url')), 'genre':str(raw.get('genre') or ''),
            'uncensored':False, 'mood':'all', 'releaseYear':str(raw.get('release_year') or ''),
            'access':raw.get('access'), 'source':'soundcloud', **discovery_metadata(raw)}

def search(query, offset=0, limit=25):
    query = str(query or '').strip()[:180]
    if query == 'telefy:freshmen': return freshmen()
    if query.startswith('telefy:discovery:'):return discovery(query.split(':')[-1],offset)
    try: offset=max(0,min(int(offset),10000)); limit=max(1,min(int(limit),50))
    except (TypeError,ValueError): raise APIError(400,'invalid_pagination')
    if len(query)<2: raise APIError(400,'query_too_short')
    key=(query.casefold(),offset,limit)
    with LOCK:
        cached=SEARCH_CACHE.get(key)
        if cached and cached[0]>time.time(): return cached[1]
    raw=api('/tracks',{'q':query,'access':'playable','limit':limit,'offset':offset,'linked_partitioning':'true'})
    items=raw.get('collection',[]) if isinstance(raw,dict) else raw
    collection=[]
    for item in items:
        if recommendation_blocked(item):continue
        if item.get('access')!='playable' or not item.get('streamable'): continue
        try: collection.append(normalize_track(item))
        except APIError: continue
    result={'tracks':collection,'nextOffset':offset+limit,'hasMore':bool(raw.get('next_href')) if isinstance(raw,dict) else len(items)==limit}
    with LOCK:
        if len(SEARCH_CACHE)>200: SEARCH_CACHE.clear()
        SEARCH_CACHE[key]=(time.time()+60,result)
    return result

def tokens(value):
    return set(re.findall(r'[a-zа-яё0-9]+',unicodedata.normalize('NFKC',str(value)).casefold()))

def resolve_track(data):
    if not isinstance(data,dict): raise APIError(400,'invalid_track')
    if data.get('soundcloudUrn'):
        raw=api('/tracks/'+quote(track_urn(data['soundcloudUrn']),safe=''))
        if raw.get('access')!='playable' or not raw.get('streamable'): raise APIError(403,'track_not_playable')
        return normalize_track(raw)
    title=tokens(data.get('title','')); artist=tokens(data.get('artist',''))
    if not title or not artist: raise APIError(400,'invalid_track')
    candidates=search(str(data.get('artist',''))+' '+str(data.get('title','')),0,25)['tracks']
    ranked=[]
    for candidate in candidates:
        ct=tokens(candidate['title']); ca=tokens(candidate['artist'])|ct|tokens(candidate['uploader'])
        title_score=len(title & ct)/len(title); artist_score=len(artist & ca)/len(artist)
        variants={'remix','slowed','sped','speed','instrumental','cover','live','karaoke'}
        wrong_variant=bool((ct-title)&variants)
        score=.75*title_score+.25*artist_score
        if title_score>=.75 and artist_score>=.5 and score>=.8 and not wrong_variant:
            ranked.append((score,candidate))
    if not ranked: raise APIError(404,'matching_track_not_found')
    return max(ranked,key=lambda pair:pair[0])[1]

class NoStreamRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def resolve_stream_url(url):
    # /streams returns an authenticated API hop, not necessarily a signed CDN URL.
    # SoundCloud recommends following that hop with an authenticated HEAD request.
    # Never forward OAuth credentials to a CDN or expose them to the browser.
    opener=build_opener(NoStreamRedirect())
    token=None
    for _ in range(5):
        parsed=urlsplit(url);host=parsed.hostname or ''
        if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443):
            raise APIError(502,'unexpected_stream_host')
        if host!='api.soundcloud.com':
            if not any(host.endswith(suffix) for suffix in ('.sndcdn.com','.soundcloud.cloud','.cloudfront.net')):
                raise APIError(502,'unexpected_stream_host')
            if {'access_token','oauth_token','client_secret'} & set(parse_qs(parsed.query)):
                raise APIError(502,'unexpected_stream_credentials')
            return url
        if not parsed.path.startswith('/tracks/') or '/streams/' not in parsed.path:
            raise APIError(502,'unexpected_stream_path')
        if token is None:token=access_token()
        request=Request(url,method='HEAD',headers={'Authorization':'OAuth '+token,'Accept':'*/*'})
        try:
            with opener.open(request,timeout=18):
                raise APIError(502,'stream_redirect_missing')
        except HTTPError as error:
            if error.code in (301,302,303,307,308):
                location=error.headers.get('Location')
                error.close()
                if not location:raise APIError(502,'stream_redirect_missing')
                url=urljoin(url,location)
                continue
            if error.code==401:
                error.close();token=access_token(invalidate=token);continue
            status=error.code;error.close()
            raise APIError(status if status in (403,404,429) else 502,'stream_authorization_failed') from None
        except (URLError,TimeoutError,OSError):raise APIError(502,'stream_resolution_failed') from None
    raise APIError(502,'stream_redirect_limit')

def stream(data):
    track=resolve_track(data)
    streams=api('/tracks/'+quote(track['soundcloudUrn'],safe='')+'/streams')
    url=safe_url(streams.get('hls_aac_160_url') or streams.get('hls_mp3_128_url'))
    if not url: raise APIError(403,'full_stream_unavailable')
    url=resolve_stream_url(url)
    return {'url':url,'protocol':'hls','track':track}

if __name__=='__main__':
    import getpass
    print('SoundCloud setup. Keys are stored outside the website and ZIP.')
    client_id=getpass.getpass('Client ID (hidden, empty to cancel): ').strip()
    if not client_id: raise SystemExit(0)
    secret=getpass.getpass('Client Secret (hidden): ').strip()
    if not secret: raise SystemExit('Cancelled')
    os.environ['SOUNDCLOUD_CLIENT_ID']=client_id
    os.environ['SOUNDCLOUD_CLIENT_SECRET']=secret
    try:
        access_token()
        write_json(DATA/'soundcloud.json',{'client_id':client_id,'client_secret':secret})
        print('SUCCESS: SoundCloud accepted the credentials. Refresh Telefy.')
    except APIError as error:
        print('Connection not confirmed: '+error.code+'. Keys were not saved.')
        raise SystemExit(1)


# Small Russian-language rap profiles, measured by followers (not listeners).
FRESHMEN_CACHE = None
FRESHMEN_LOCK = threading.Lock()
def freshmen():
    global FRESHMEN_CACHE
    with FRESHMEN_LOCK:
        if FRESHMEN_CACHE and FRESHMEN_CACHE[0]>time.time(): return FRESHMEN_CACHE[1]
        users=[];seen=set()
        for query in ('russian plugg','русский new jazz','russian rage','русский hyperpop'):
            raw=api('/users',{'q':query,'limit':50,'linked_partitioning':'true'})
            for user in (raw.get('collection',[]) if isinstance(raw,dict) else raw):
                followers=user.get('followers_count')
                urn=str(user.get('urn') or ('soundcloud:users:'+str(user.get('id',''))))
                if not re.fullmatch(r'soundcloud:users:\d+',urn) or urn in seen:continue
                if not isinstance(followers,int) or not 5000<=followers<=10000:continue
                seen.add(urn);users.append((urn,user))
            if len(users)>=8:break
        from concurrent.futures import ThreadPoolExecutor
        def pick(pair):
            urn,user=pair
            try:
                # Verify audience again from the profile rather than trusting search snippets.
                profile=api('/users/'+quote(urn,safe=''))
                count=profile.get('followers_count')
                if not isinstance(count,int) or not 5000<=count<=10000:return []
                raw=api('/users/'+quote(urn,safe='')+'/tracks',{'limit':30,'linked_partitioning':'true'})
                result=[]
                for track in (raw.get('collection',[]) if isinstance(raw,dict) else raw):
                    if track.get('access')!='playable' or not track.get('streamable'):continue
                    text=' '.join(str(track.get(k) or '') for k in ('title','genre','tag_list'))
                    if not re.search('[а-яё]',text,re.I):continue
                    if not re.search(r'plugg|new.?jazz|rage|hyperpop|trap|трэп|нью.?джаз|гиперпоп',text,re.I):continue
                    if re.search(r'chanson|шансон|блатн|воровск|тюрем|gangsta|пацанск',text,re.I):continue
                    if recommendation_blocked(track):continue
                    if re.search(r'remix|reupload|sped.?up|slowed|перезалив|cover',text,re.I):continue
                    item=normalize_track(track)
                    # Reject a credited artist different from the small uploader.
                    credit=tokens(item['artist']);owner=tokens(profile.get('username',''))
                    if credit and owner and not credit.intersection(owner):continue
                    item['freshmanFollowers']=count;item['freshmanProfile']=urn
                    result.append(item)
                    if len(result)==2:break
                return result
            except APIError:return []
        with ThreadPoolExecutor(max_workers=3) as pool:
            items=[t for batch in pool.map(pick,users[:8]) for t in batch]
        result={'tracks':items,'nextOffset':0,'hasMore':False,'metric':'followers','min':5000,'max':10000}
        FRESHMEN_CACHE=(time.time()+(600 if items else 120),result)
        return result


def recommendation_blocked(track):
    user=track.get('user') or {}
    credit=' '.join(str(track.get(k) or '') for k in ('artist','metadata_artist','title'))+' '+str(user.get('username') or '')
    return bool(re.search(r'(?<![\w])(?:баста|basta|ноггано|noggano|naggano)(?![\w])',credit,re.I))

DISCOVERY_CACHE={}
def discovery_metadata(raw):
    from datetime import datetime,timezone
    text=' '.join(str(raw.get(k) or '') for k in ('title','genre','tag_list','metadata_artist')).casefold()
    bpm=raw.get('bpm') or 0
    aggressive=bool(re.search(r'rage|hardcore|hard.?trap|hardbass|hardstyle|drill|phonk|distort|metal|diss|aggress|агресс|хардкор|дисс|1.?kla[$sс]+|1.?клас|первый класс',text,re.I))
    chill=bool(re.search(r'chill|lo.?fi|ambient|relax|jazz.?rap|r.?n.?b|спокой|чилл',text)) and not aggressive and not (isinstance(bpm,(int,float)) and bpm>115)
    heavy=bool(re.search(r'rage|hardcore|hard.?trap|808|distort|supertrap|madk1d|madkid|fortune 812|тёмный принц|темный принц',text))
    energy=not chill and (heavy or bool(re.search(r'drill|phonk|energetic|бодр|энерг',text)) or (isinstance(bpm,(int,float)) and bpm>=115))
    plays=int(raw.get('playback_count') or 0);likes=int(raw.get('likes_count') or raw.get('favoritings_count') or 0)
    date=raw.get('release_date')
    if not date and raw.get('release_year'):
        date=f"{raw['release_year']}-{int(raw.get('release_month') or 1):02d}-{int(raw.get('release_day') or 1):02d}"
    created=raw.get('created_at')
    def age(value):
        try:return (datetime.now(timezone.utc)-datetime.fromisoformat(str(value).replace('Z','+00:00')).astimezone(timezone.utc)).days
        except (ValueError,TypeError):return 99999
    fresh=0<=age(created)<=60
    russian=bool(re.search('[а-яё]',text))
    modes=[]
    if energy:modes.append('energy')
    if chill:modes.append('night')
    if heavy:modes.append('uncensored')
    if russian and fresh and (plays>=10000 or likes>=250):modes.append('underground')
    return dict(classificationVersion=2,modes=modes,releaseDate=date,createdAt=created,playbackCount=plays,likesCount=likes)

def discovery(kind,offset=0):
    from datetime import datetime,timezone
    from concurrent.futures import ThreadPoolExecutor
    if kind not in ('energy','night','uncensored','underground','hits','legends','premiere','telescope'):raise APIError(400,'invalid_discovery')
    offset=max(0,min(int(offset),6));key=(kind,offset)
    cached=DISCOVERY_CACHE.get(key)
    if cached and cached[0]>time.time():return cached[1]
    artists=['PHARAOH','ЛСП','Big Baby Tape','KIZARU','Скриптонит','fortune 812','Markul','OG Buda','SALUKI','9mice','Kai Angel','madk1d','Boulevard Depo','GONE.Fludd','BUSHIDO ZHO','ALBLAK 52','FRIENDLY THUG 52 NGG','MAYOT','Aarne','Toxi$','SODA LUV','OBLADAET','FEDUK','темный принц','Платина','LIL KRYSTALLL','ATL','Хаски']
    queries={
      'energy':['russian drill','русский фонк','BUSHIDO ZHO','ALBLAK 52'],
      'night':['русский chill','russian lofi rap','русский rnb','jazz rap русский'],
      'uncensored':['madk1d','fortune 812','темный принц','russian rage'],
      'underground':['русский рэп','russian trap','9mice','Kai Angel'],
      'legends':['PHARAOH','KIZARU','Big Baby Tape','Boulevard Depo','ЛСП'],
      'telescope':['Kai Angel','9mice','PHARAOH','ЛСП','fortune 812','FRIENDLY THUG 52 NGG'],
    }.get(kind,artists[offset*4:offset*4+4])
    if not queries:return {'tracks':[],'hasMore':False,'nextOffset':0}
    def get(q):
        try:
            found=search(q,0,50)['tracks']
            if kind=='telescope':
                artist=tokens(q)
                found=[t for t in found if artist.issubset(tokens(t.get('artist',''))) and not re.search(r'remix|sped|slowed|reupload|cover|instrumental',t.get('title',''),re.I)]
                return sorted(found,key=lambda t:t.get('playbackCount',0),reverse=True)[:8]
            return found
        except APIError:return []
    with ThreadPoolExecutor(max_workers=4) as pool:items=[t for batch in pool.map(get,queries) for t in batch]
    result=[];seen=set();today=datetime.now(timezone.utc).date()
    for t in items:
        if recommendation_blocked(t):continue
        # Filter credited performers and collabs, not only seed search queries.
        credit=' '.join(str(t.get(k) or '') for k in ('artist','title')).casefold()
        if kind in ('hits','legends') and re.search(r'(?<![\w])(?:miyagi|miyage|мияги|мияджи|баста|basta|ноггано|ногано|noggano|naggano)(?![\w])',credit):continue
        if kind=='legends' and re.search(r'(?<![\w])(?:каста|kasta|гуф|guf|кравц|kravz)(?![\w])',credit):continue
        if t['soundcloudUrn'] in seen:continue
        if kind in ('hits','legends','premiere') and not tokens(t.get('artist','')).intersection(tokens(' '.join(queries))):continue
        if kind in ('energy','night','uncensored','underground') and kind not in t.get('modes',[]):continue
        if kind in ('hits','premiere'):
            try:date=datetime.fromisoformat(str(t.get('releaseDate')).replace('Z','+00:00')).date()
            except (ValueError,TypeError):continue
            if kind=='hits' and not (2017<=date.year<=2026 and (t.get('playbackCount',0)>=100000 or t.get('likesCount',0)>=1000)):continue
            if kind=='premiere' and not 0<=(today-date).days<=45:continue
        seen.add(t['soundcloudUrn']);result.append(t)
    result.sort(key=lambda t:t.get('releaseDate') or '',reverse=True) if kind=='premiere' else result.sort(key=lambda t:t.get('playbackCount',0)+t.get('likesCount',0)*30,reverse=True)
    data={'tracks':result[:100],'hasMore':kind in ('hits','premiere') and offset<6,'nextOffset':offset+1,'source':'soundcloud','selection':'metadata-and-editorial'}
    DISCOVERY_CACHE[key]=(time.time()+600,data)
    return data

"""Official SoundCloud public API. Credentials and tokens never enter frontend code."""
from music_policy import language_blocked
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
        with urlopen(request, timeout=18) as response:
            observe_rate(url,response.headers,response.status)
            return json.load(response)
    except HTTPError as error:
        observe_rate(url,error.headers,error.code)
        if error.code == 403:
            body = error.read(6000).decode('utf-8','replace')
            if 'block access from your country' in body.lower():
                raise APIError(403,'soundcloud_geo_blocked') from None
        code = {400:'soundcloud_bad_request',401:'soundcloud_auth_failed',403:'soundcloud_forbidden',404:'soundcloud_not_found',429:'soundcloud_rate_limited'}.get(error.code,'soundcloud_unavailable')
        failure=APIError(error.code if error.code in (400,401,403,404,429) else 502,code)
        if error.code==429:
            from email.utils import parsedate_to_datetime
            retry=error.headers.get('Retry-After','')
            try:seconds=float(retry)
            except ValueError:
                try:seconds=parsedate_to_datetime(retry).timestamp()-time.time()
                except (ValueError,TypeError,OverflowError):
                    try:seconds=float(error.headers.get('X-Ratelimit-Reset','0'))-time.time()
                    except ValueError:seconds=60
                    if seconds<=0:seconds=60
            failure.retry_after=max(1,min(seconds,86400))
        raise failure from None
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
    if language_blocked(raw):raise APIError(403,'track_language_blocked')
    urn = track_urn(raw.get('urn') or raw.get('id'))
    user = raw.get('user') or {}
    title = str(raw.get('title') or '').strip()
    artist = str(raw.get('metadata_artist') or (raw.get('publisher_metadata') or {}).get('artist') or '').strip()
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
            'artistImg':safe_url(user.get('avatar_url')), 'genre':str(raw.get('genre') or ''), 'tag_list':str(raw.get('tag_list') or ''),
            'uncensored':False, 'mood':'all', 'releaseYear':str(raw.get('release_year') or ''),
            'access':raw.get('access'), 'source':'soundcloud', **discovery_metadata({**raw,'metadata_artist':artist})}

def search(query, offset=0, limit=25):
    query = str(query or '').strip()[:180]
    if query == 'telefy:discovery:diagnostics':return {'modes':MODE_DIAGNOSTICS}
    if query == 'telefy:freshmen:diagnostics': return {'batches':dict(FRESHMEN_DIAGNOSTICS)}
    if query.startswith('telefy:cover:'):return collection_cover(query.split(':')[-1])
    if query == 'telefy:freshmen': return freshmen(offset)
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
        compact=lambda value:''.join(re.findall(r'[a-zа-яё0-9]+',unicodedata.normalize('NFKC',str(value)).casefold()))
        title_score=1.0 if compact(data.get('title',''))==compact(candidate['title']) else len(title & ct)/len(title)
        artist_score=1.0 if compact(data.get('artist',''))==compact(candidate['artist']) else len(artist & ca)/len(artist)
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
FRESHMEN_CACHE={}
FRESHMEN_DIAGNOSTICS={}
FRESHMEN_LOCK=threading.Lock()
FRESHMEN_SOURCES=(
 {'tags':'plugg'}, {'tags':'newjazz'}, {'tags':'rage'},
 {'genres':'Hip-hop & Rap','q':'русский'}, {'tags':'trap'},
 {'q':'русский рэп'}, {'tags':'pluggnb'}, {'q':'рэп'},
 {'tags':'hyperpop'}, {'q':'russian underground'})

def freshmen(offset=0):
    from concurrent.futures import ThreadPoolExecutor
    batch=max(0,min(int(offset),len(FRESHMEN_SOURCES)-1))
    period=int(time.time()//21600);cache_key=(period,batch)
    with FRESHMEN_LOCK:
        cached=FRESHMEN_CACHE.get(cache_key)
        if cached and cached[0]>time.time():return cached[1]
    stats={'tracks_found':0,'candidate_profiles':0,'profiles_returned':0,'audience_matches':0,'missing_audience':0,'outside_audience':0,'profile_errors':0,'track_errors':0,'accepted':0}
    errors=[]
    def items(raw):return (raw.get('collection',[]) if isinstance(raw,dict) else raw) or []
    params={**FRESHMEN_SOURCES[batch],'limit':100,'access':'playable','linked_partitioning':'true'}
    try:songs=items(api('/tracks',params))
    except APIError as e:
        FRESHMEN_DIAGNOSTICS[batch]={'stage':'track_search','error':e.code,**stats};raise
    stats['tracks_found']=len(songs)
    candidates={};banned=r'chanson|шансон|блатн|воровск|тюрем|gangsta|пацанск'
    variants=r'remix|reupload|sped.?up|slowed|перезалив|cover|instrumental'
    for track in songs:
        if recommendation_blocked(track) or language_blocked(track):continue
        text=' '.join(str(track.get(k) or '') for k in ('title','description','tag_list'))
        if re.search(banned,text,re.I):continue
        user=track.get('user') or {};urn=str(user.get('urn') or ('soundcloud:users:'+str(user.get('id',''))))
        if not re.fullmatch(r'soundcloud:users:\d+',urn):continue
        count=user.get('followers_count')
        if isinstance(count,int) and not 5000<=count<=10000:continue
        candidates.setdefault(urn,[]).append(track)
    # Cyrillic songs first: don't spend all profile requests on English results.
    def russian_seeds(pair):return sum(bool(re.search('[а-яё]',str(t.get('title',''))+' '+str(t.get('description','')),re.I)) for t in pair[1])
    pairs=sorted(candidates.items(),key=russian_seeds,reverse=True)[:32]
    stats['candidate_profiles']=len(pairs)
    profiles={}
    if pairs:
        try:
            data=api('/users',{'urns':','.join(u for u,_ in pairs),'limit':len(pairs),'linked_partitioning':'true'})
            for p in items(data):
                urn=str(p.get('urn') or ('soundcloud:users:'+str(p.get('id',''))));profiles[urn]=p
        except APIError as e:errors.append(e.code)
    def detail(pair):
        urn,seeds=pair
        if urn in profiles:return urn,profiles[urn]
        try:return urn,api('/users/'+quote(urn,safe=''))
        except APIError as e:return urn,{'_error':e.code}
    with ThreadPoolExecutor(max_workers=4) as pool:details=list(pool.map(detail,pairs))
    qualified=[]
    for urn,p in details:
        if '_error' in p:stats['profile_errors']+=1;errors.append(p['_error']);continue
        stats['profiles_returned']+=1;count=p.get('followers_count')
        if not isinstance(count,int):stats['missing_audience']+=1;continue
        if not 5000<=count<=10000:stats['outside_audience']+=1;continue
        stats['audience_matches']+=1;qualified.append((urn,p,candidates[urn]))
    def pick(pair):
        urn,p,seeds=pair;profile_text=' '.join(str(p.get(k) or '') for k in ('username','full_name','description'))
        if re.search(banned,profile_text,re.I) or recommendation_blocked(p):return [],None
        tracks=list(seeds)
        try:tracks+=items(api('/users/'+quote(urn,safe='')+'/tracks',{'limit':30,'linked_partitioning':'true'}))
        except APIError as e:error=e.code
        else:error=None
        selected=[];seen=set()
        for track in tracks:
            if track.get('access')!='playable' or not track.get('streamable'):continue
            text=' '.join(str(track.get(k) or '') for k in ('title','genre','tag_list','description'))
            if not re.search('[а-яё]',text+' '+profile_text,re.I):continue
            if re.search(banned,text,re.I) or re.search(variants,str(track.get('title') or ''),re.I):continue
            if recommendation_blocked(track) or language_blocked(track):continue
            # A seed returned for a genre tag already has genre evidence. Missing
            # redundant tags on that song must not throw away a valid candidate.
            if track not in seeds and not re.search(r'rap|hip.?hop|рэп|plugg|jazz|rage|hyperpop|trap|трэп',text,re.I):continue
            owner=tokens(str(p.get('username') or '')+' '+str(p.get('full_name') or ''));credit=tokens(track.get('metadata_artist') or '')
            if credit and owner and not credit.intersection(owner):continue
            try:item=normalize_track(track)
            except APIError:continue
            if not credit:item['artist']=item['primaryArtist']=p.get('username') or item['artist']
            if item['soundcloudUrn'] in seen:continue
            seen.add(item['soundcloudUrn']);item['freshmanFollowers']=p['followers_count'];item['freshmanProfile']=urn;selected.append(item)
            if len(selected)>=3:break
        return selected,error
    with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(pick,qualified[:12]))
    tracks=[]
    for group,error in results:
        tracks+=group
        if error:stats['track_errors']+=1;errors.append(error)
    stats['accepted']=len(tracks)
    FRESHMEN_DIAGNOSTICS[batch]={'stage':'complete','errors':sorted(set(errors)),**stats}
    # API failures are failures, not a successful empty recommendation list.
    lookup_failed=bool(pairs and stats['profile_errors']==len(pairs))
    source_failed=bool(not tracks and errors and stats['track_errors'])
    # Explicit editorial artist picks may exceed 5–10k: user-approved exception.
    import random
    rotation=random.Random(period).sample(SCENE_ROSTER,len(SCENE_ROSTER))
    editorial=rotation[batch*3:batch*3+3]
    for cfg in editorial:
        try:
            choices=search(cfg['name'],0,25)['tracks']
            choices=[t for t in choices if scene_matches(t.get('artist',''),cfg) and rap_candidate(t)]
            # Rotate within an artist as the six-hour snapshot changes.
            choices.sort(key=lambda t:hashlib.sha256((str(period)+t['soundcloudUrn']).encode()).hexdigest())
            for item in choices[:2]:item=dict(item);item['editorialPick']=True;item['editorialArtist']=cfg['name'];tracks.append(item)
        except APIError as e:errors.append(e.code)
    dedup={t['soundcloudUrn']:t for t in tracks};tracks=list(dedup.values())
    FRESHMEN_DIAGNOSTICS[batch]={'stage':'ready' if tracks else 'empty','errors':sorted(set(errors)),**stats,'editorial_accepted':sum(bool(t.get('editorialPick')) for t in tracks),'period':period}
    if not tracks and errors:raise APIError(502,'freshmen_sources_unavailable')
    result={'tracks':tracks,'nextOffset':batch+1,'hasMore':batch<len(FRESHMEN_SOURCES)-1,'metric':'followers-or-editorial','min':5000,'max':10000,'period':period}

    with FRESHMEN_LOCK:
        FRESHMEN_CACHE[cache_key]=((period+1)*21600 if tracks else time.time()+15,result)
        if len(FRESHMEN_CACHE)>30:
            for k in list(FRESHMEN_CACHE):
                if k[0]!=period:FRESHMEN_CACHE.pop(k,None)
    return result

COLLECTION_COVER_CACHE={}
def collection_cover(kind):
    queries={'hits':'PHARAOH Дико например','legends':'Big Baby Tape Gimme the Loot','premiere':'9mice','telescope':'Kai Angel'}
    if kind not in queries:raise APIError(400,'invalid_collection')
    cached=COLLECTION_COVER_CACHE.get(kind)
    if cached and cached[0]>time.time():return cached[1]
    tracks=search(queries[kind],0,8)['tracks']
    cover=next((t['coverImg'] for t in tracks if t.get('coverImg')),'')
    data={'coverImg':cover,'tracks':[],'hasMore':False,'nextOffset':0}
    if cover:COLLECTION_COVER_CACHE[kind]=(time.time()+3600,data)
    return data

def recommendation_blocked(track):
    user=track.get('user') or {}
    credit=' '.join(str(track.get(k) or '') for k in ('artist','metadata_artist','title'))+' '+str(user.get('username') or '')
    return bool(re.search(r'(?<![\w])(?:баста|basta|ноггано|noggano|naggano)(?![\w])',credit,re.I))

# Search credits, not the uploader display name, identify the promoted artist.
SCENE_ROSTER=json.loads(Path(__file__).with_name('scene_roster.json').read_text(encoding='utf-8'))
def scene_artist(artist):
    text=' '.join(sorted(tokens(artist)))
    words=tokens(artist)
    for cfg in SCENE_ROSTER:
        if any(tokens(a) and tokens(a).issubset(words) for a in [cfg['name']]+cfg['aliases']):return cfg
    return None

LEGENDS_ARTISTS=['PHARAOH', 'Boulevard Depo', 'ЛСП', 'Markul', 'OG Buda', 'SODA LUV', 'KIZARU', 'Big Baby Tape', 'Morgenshtern', 'Kai Angel', 'Mnogoznaal', 'Jeembo', 'TVETH', 'BATO']
HITS_ADDITIONS=['Miyagi', 'PHARAOH', 'Boulevard Depo', 'FRIENDLY THUG 52 NGG', 'Whole Lotta Swag']
DISCOVERY_CACHE={}
def discovery_metadata(raw):
    from datetime import datetime,timezone
    text=' '.join(str(raw.get(k) or '') for k in ('title','genre','tag_list','metadata_artist')).casefold()
    bpm=raw.get('bpm') or 0
    aggressive=bool(re.search(r'rage|hardcore|hard.?trap|hardbass|hardstyle|drill|phonk|distort|metal|diss|aggress|агресс|хардкор|дисс|1.?kla[$sс]+|1.?клас|первый класс',text,re.I))
    chill=bool(re.search(r'chill|lo.?fi|ambient|relax|jazz.?rap|r.?n.?b|спокой|чилл',text)) and not aggressive and not (isinstance(bpm,(int,float)) and bpm>115)
    scene=scene_artist(raw.get('metadata_artist') or raw.get('title') or '')
    heavy=bool(scene and scene['style']=='hard' and not chill) or bool(re.search(r'rage|hardcore|hard.?trap|808|distort|supertrap|madk1d|madkid|fortune 812|тёмный принц|темный принц',text))
    energy=not chill and (heavy or bool(re.search(r'drill|phonk|energetic|бодр|энерг',text)) or (isinstance(bpm,(int,float)) and bpm>=115))
    plays=int(raw.get('playback_count') or 0);likes=int(raw.get('likes_count') or raw.get('favoritings_count') or 0)
    date=raw.get('release_date')
    if not date and raw.get('release_year'):
        date=f"{raw['release_year']}-{int(raw.get('release_month') or 1):02d}-{int(raw.get('release_day') or 1):02d}"
    created=raw.get('created_at')
    def age(value):
        parsed=None
        try:parsed=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        except (ValueError,TypeError):
            for fmt in ('%Y/%m/%d %H:%M:%S %z','%Y-%m-%d %H:%M:%S %z'):
                try:parsed=datetime.strptime(str(value),fmt);break
                except (ValueError,TypeError):pass
        if parsed is None:return 99999
        if parsed.tzinfo is None:parsed=parsed.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc)-parsed.astimezone(timezone.utc)).days
    fresh=0<=age(raw.get('release_date') or (date if raw.get('release_month') else None) or created)<=180
    if raw.get('release_year') and int(raw['release_year'])<datetime.now(timezone.utc).year-1:fresh=False
    credit=raw.get('metadata_artist') or ''
    russian=bool(re.search('[а-яё]',text)) or bool(scene_artist(credit)) or any(tokens(a).issubset(tokens(credit)) for a in LEGENDS_ARTISTS+HITS_ADDITIONS+['Villian','baby cute','Toxi$','9mice','FRIENDLY THUG 52 NGG','BUSHIDO ZHO','ALBLAK 52','MAYOT','SALUKI','OBLADAET','GONE.Fludd','Toxi$','Aarne'])
    modes=[]
    if energy:modes.append('energy')
    if chill:modes.append('night')
    if heavy:modes.append('uncensored')
    if russian and fresh and (plays>=1000 or likes>=50):modes.append('underground')
    return dict(classificationVersion=4,modes=modes,releaseDate=date,createdAt=created,playbackCount=plays,likesCount=likes)

def discovery(kind,offset=0):
    from datetime import datetime,timezone
    from concurrent.futures import ThreadPoolExecutor
    if kind not in ('scene','energy','night','uncensored','underground','hits','legends','premiere','telescope'):raise APIError(400,'invalid_discovery')
    offset=max(0,min(int(offset),30));key=(kind,offset)
    cached=DISCOVERY_CACHE.get(key)
    if cached and cached[0]>time.time():return cached[1]
    artists=['PHARAOH','ЛСП','Big Baby Tape','KIZARU','Скриптонит','fortune 812','Markul','OG Buda','SALUKI','9mice','Kai Angel','madk1d','Boulevard Depo','GONE.Fludd','BUSHIDO ZHO','ALBLAK 52','FRIENDLY THUG 52 NGG','MAYOT','Aarne','Toxi$','SODA LUV','OBLADAET','FEDUK','темный принц','Платина','LIL KRYSTALLL','ATL','Хаски']
    scene_queries=[c['name'] for c in SCENE_ROSTER]
    energy_queries=list(dict.fromkeys(scene_queries+['russian drill','русский фонк','BUSHIDO ZHO','ALBLAK 52','russian rage']))
    telescope_queries=scene_queries+[a for a in artists if not scene_artist(a)]
    hits_queries=list(dict.fromkeys(HITS_ADDITIONS+telescope_queries))
    trends_queries=list(dict.fromkeys(scene_queries+artists))
    queries={
      'scene':scene_queries[offset*4:offset*4+4],
      'energy':energy_queries[offset*4:offset*4+4],
      'night':['русский chill','russian lofi rap','русский rnb','jazz rap русский'],
      'uncensored':([c['name'] for c in SCENE_ROSTER if c['style']=='hard']+['russian rage'])[offset*4:offset*4+4],
      'underground':trends_queries[offset*4:offset*4+4],
      'legends':LEGENDS_ARTISTS[offset*4:offset*4+4],
      'hits':hits_queries[offset*4:offset*4+4],
      'telescope':telescope_queries[offset*4:offset*4+4],
    }.get(kind,telescope_queries[offset*4:offset*4+4])
    if not queries:return {'tracks':[],'hasMore':False,'nextOffset':0}
    source_errors=[]
    def get(q):
        try:
            if kind=='underground':
                from datetime import timedelta
                since=(datetime.now(timezone.utc)-timedelta(days=90)).strftime('%Y-%m-%d %H:%M:%S')
                raw=api('/tracks',{'q':q,'access':'playable','limit':50,'created_at[from]':since,'linked_partitioning':'true'})
                found=[]
                for item in (raw.get('collection',[]) if isinstance(raw,dict) else raw):
                    if item.get('access')!='playable' or not item.get('streamable'):continue
                    try:track=normalize_track(item)
                    except APIError:continue
                    if tokens(q).issubset(tokens(track.get('artist',''))):found.append(track)
            else:found=search(q,0,50)['tracks']
            if kind in ('scene','telescope','energy','uncensored'):
                cfg=scene_artist(q);artist=tokens(q)
                found=[t for t in found if ((cfg and scene_matches(t.get('artist',''),cfg)) or (not cfg and kind in ('energy','uncensored')) or (not cfg and artist.issubset(tokens(t.get('artist',''))))) and not re.search(r'remix|sped|slowed|reupload|cover|instrumental',t.get('title',''),re.I)]
                return sorted(found,key=lambda t:t.get('playbackCount',0),reverse=True)[:15]
            return found
        except APIError as e:source_errors.append(e);return []
    with ThreadPoolExecutor(max_workers=4) as pool:items=[t for batch in pool.map(get,queries) for t in batch]
    if not items and source_errors:raise source_errors[0]
    result=[];seen=set();today=datetime.now(timezone.utc).date()
    for t in items:
        if recommendation_blocked(t) or not rap_candidate(t):continue
        # Filter credited performers and collabs, not only seed search queries.
        credit=' '.join(str(t.get(k) or '') for k in ('artist','title')).casefold()
        if kind=='legends' and re.search(r'(?<![\w])(?:miyagi|miyage|мияги|мияджи|баста|basta|ноггано|ногано|noggano|naggano)(?![\w])',credit):continue
        if kind=='legends' and re.search(r'(?<![\w])(?:каста|kasta|гуф|guf|кравц|kravz)(?![\w])',credit):continue
        if t['soundcloudUrn'] in seen:continue
        if kind in ('hits','legends','premiere') and not any(tokens(q).issubset(tokens(t.get('artist',''))) for q in queries):continue
        if kind=='energy' and not set(t.get('modes',[])).intersection(('energy','uncensored')):continue
        if kind in ('night','uncensored','underground') and kind not in t.get('modes',[]):continue
        if kind in ('hits','premiere'):
            try:date=datetime.fromisoformat(str(t.get('releaseDate')).replace('Z','+00:00')).date()
            except (ValueError,TypeError):
                if kind!='hits':continue
                try:date=datetime.fromisoformat(str(t.get('createdAt')).replace('Z','+00:00')).date()
                except (ValueError,TypeError):
                    try:date=datetime.strptime(str(t.get('createdAt')),'%Y/%m/%d %H:%M:%S %z').date()
                    except (ValueError,TypeError):continue
            if kind=='hits' and not (2017<=date.year<=2026 and (t.get('playbackCount',0)>=100000 or t.get('likesCount',0)>=1000)):continue
            if kind=='premiere' and not 0<=(today-date).days<=90:continue
        seen.add(t['soundcloudUrn']);result.append(t)
    if not result and source_errors:raise source_errors[0]
    result.sort(key=lambda t:t.get('releaseDate') or '',reverse=True) if kind=='premiere' else result.sort(key=lambda t:t.get('playbackCount',0)+t.get('likesCount',0)*30,reverse=True)
    data={'tracks':result[:250],'hasMore':((offset+1)*4<len(LEGENDS_ARTISTS if kind=='legends' else hits_queries if kind=='hits' else trends_queries if kind=='underground' else scene_queries if kind=='scene' else energy_queries if kind=='energy' else scene_queries+['russian rage'] if kind=='uncensored' else telescope_queries) and kind!='night'),'nextOffset':offset+1,'source':'soundcloud','selection':'metadata-and-editorial'}
    DISCOVERY_CACHE[key]=(time.time()+600,data)
    return data

"""Append to soundcloud_api.py via the release builder."""
PROMOTION_EXCLUDED=re.compile(r'(?<![\w])(?:баста|basta|ноггано|noggano|нагано|1.?клас|1.?kla[$sс]+|смоки\s*мо|smoky\s*mo|smokey\s*mo)(?![\w])',re.I)

def scene_matches(artist,cfg):
    words=tokens(artist)
    return any(tokens(a) and tokens(a).issubset(words) for a in [cfg['name']]+cfg.get('aliases',[]))

def recommendation_blocked(track):
    credit=' '.join(str(track.get(k) or '') for k in ('artist','metadata_artist','title'))
    return bool(PROMOTION_EXCLUDED.search(credit))

def rap_candidate(track):
    if recommendation_blocked(track) or language_blocked(track):return False
    text=' '.join(str(track.get(k) or '') for k in ('genre','tag_list','tags'))
    if re.search(r'chanson|шансон|bollywood|bhangra|filmi|hindustani|carnatic',text,re.I):return False
    # All artists, including Cupsize, pass the same content rule.
    if re.search(r'hip.?hop|rap|рэп|trap|трэп|drill|rage|plugg|phonk|cloud',text,re.I):return True
    credit=track.get('artist') or track.get('metadata_artist') or ''
    if 'night' in track.get('modes',[]) and any(tokens(a).issubset(tokens(credit)) for a in CHILL_ARTISTS) and not re.search(r'rock|metal',text,re.I):return True
    cfg=scene_artist(credit)
    # Missing genre can use a known rap artist; explicit rock/pop genre does not.
    return not text.strip() and (bool(cfg and cfg.get('style')=='hard') or any(tokens(a).issubset(tokens(credit)) for a in LEGENDS_ARTISTS+HITS_ADDITIONS+['Villian','baby cute','Toxi$']))

def smart_queries(query):
    import difflib
    word=query.casefold().replace('ё','е').strip()
    aliases={}
    for c in SCENE_ROSTER+[{'name':'PHARAOH','aliases':['фараон','фара','phara']},{'name':'ЛСП','aliases':['lsp']},{'name':'KIZARU','aliases':['кизару']}]:
        extra={'madk1d':['мэд','мед','мэдкид'],'Kai Angel':['кай'],'tuborosho':['тубо'],'FORTUNA 812':['фортуна']}.get(c['name'],[])
        for a in [c['name']]+c.get('aliases',[])+extra:aliases[a.casefold().replace('ё','е')]=c['name']
    direct=[]
    if len(word)>=3:
        for a,name in aliases.items():
            if a.startswith(word) or a==word:direct.append(name)
    if not direct and len(word)>=4:
        near=difflib.get_close_matches(word,aliases.keys(),n=2,cutoff=.76)
        direct=[aliases[a] for a in near]
    names=list(dict.fromkeys(direct))[:3]
    return names or [query],names

def smart_search(query,offset=0,limit=25):
    query=str(query or '').strip()[:180]
    if query=='telefy:welcome':return welcome_track()
    if query.startswith('telefy:'):return _original_search(query,offset,limit)
    queries,names=smart_queries(query)
    if not names:return _original_search(query,offset,limit)
    result=[];seen=set();more=False
    for q in queries:
        data=_original_search(q,offset,limit);more=more or data.get('hasMore',False)
        for item in data['tracks']:
            if item['soundcloudUrn'] not in seen:seen.add(item['soundcloudUrn']);result.append(item)
    return {'tracks':result,'hasMore':more,'nextOffset':int(offset)+int(limit),'queryArtists':names}

def welcome_track():
    import secrets
    # No personal history or preference weights affect this selection.
    hit_pages=max(1,(len(set([c['name'] for c in SCENE_ROSTER]+HITS_ADDITIONS+LEGENDS_ARTISTS))+3)//4)
    candidates=discovery('hits',secrets.randbelow(hit_pages)).get('tracks',[])
    if not candidates:candidates=discovery('scene',secrets.randbelow(max(1,(len(SCENE_ROSTER)+3)//4))).get('tracks',[])
    candidates=[t for t in candidates if rap_candidate(t) and not re.search(r'remix|slowed|sped|cover|karaoke',t.get('title',''),re.I)]
    if not candidates:raise APIError(503,'welcome_tracks_unavailable')
    return {'tracks':[secrets.choice(candidates)],'hasMore':False,'nextOffset':0}

# Curated discovery and ordinary search use the same smart alias routing.
_original_search=search
search=smart_search

"""Mode-specific candidate retrieval and aggregate diagnostics."""
MODE_DIAGNOSTICS={}
CHILL_ARTISTS=['PHARAOH','ЛСП','SALUKI','Boulevard Depo','Markul','Mnogoznaal','SODA LUV','Miyagi','OG Buda','Big Baby Tape','KIZARU','FRIENDLY THUG 52 NGG']
TREND_FIRST=['madk1d','Villian','Kai Angel','9mice','темный принц','FORTUNA 812','OG Buda','baby cute','Toxi$']
TREND_SECOND=['Big Baby Tape','KIZARU','PHARAOH','RMW','huzzy b']
_previous_trend_order=list(dict.fromkeys(['madk1d','Villian','OG Buda','темный принц','FORTUNA 812','FRIENDLY THUG 52 NGG','9mice','Kai Angel','Big Baby Tape','PHARAOH','SODA LUV']+[c['name'] for c in SCENE_ROSTER]+LEGENDS_ARTISTS))
_prioritized={a.casefold()for a in TREND_FIRST+TREND_SECOND}
_trend_rest=[a for a in _previous_trend_order if a.casefold()not in _prioritized]
TREND_PAGES=[TREND_FIRST,TREND_SECOND]+[_trend_rest[i:i+4]for i in range(0,len(_trend_rest),4)]
_catalog_discovery=discovery
def discovery(kind,offset=0):
    if kind not in ('night','underground'):return _catalog_discovery(kind,offset)
    from datetime import datetime,timezone,timedelta
    from concurrent.futures import ThreadPoolExecutor
    offset=max(0,min(int(offset),30));key=('modes-diverse-v3',kind,offset)
    cached=DISCOVERY_CACHE.get(key)
    if cached and cached[0]>time.time():return cached[1]
    queries=CHILL_ARTISTS[offset*2:offset*2+2]if kind=='night'else (TREND_PAGES[offset]if offset<len(TREND_PAGES)else [])
    if kind=='underground' and offset==0:queries=list(queries)+['madk1d супермаркет','madk1d так похуй']
    artist_stats={}
    def get(q):
        params={'q':q,'access':'playable','limit':50,'linked_partitioning':'true'}
        # Explicit soft tags retrieve a different set from a broad relevance search.
        requests=[params] if kind=='underground' else [params,{**params,'tags':'chill'}]
        result=[];raw_count=0;errors=[]
        for request in requests:
            if result:break
            try:
                raw=api('/tracks',request);items=raw.get('collection',[])if isinstance(raw,dict)else raw
                raw_count+=len(items)
                for item in items:
                    if item.get('access')!='playable' or not item.get('streamable'):continue
                    try:t=normalize_track(item)
                    except APIError:continue
                    cfg=scene_artist(q)
                    if not ((cfg and scene_matches(t['artist'],cfg)) or tokens('madk1d' if q.startswith('madk1d ') else q).issubset(tokens(t['artist']))):continue
                    if not rap_candidate(t):continue
                    if kind=='underground':
                        if t.get('playbackCount',0)<1000 and t.get('likesCount',0)<50:continue
                        if 'underground'not in t['modes']:t['modes'].append('underground')
                    elif kind not in t.get('modes',[]):continue
                    if re.search(r'remix|sped|slowed|karaoke|instrumental',t['title'],re.I):continue
                    result.append(t)
            except APIError as e:
                errors.append(e.code)
                if e.status==429:break
        if kind=='underground':result=sorted(result,key=lambda t:t.get('playbackCount',0)+30*t.get('likesCount',0),reverse=True)[:10]
        artist_stats[q]={'raw':raw_count,'accepted':len(result),'errors':errors}
        return result,raw_count,errors
    with ThreadPoolExecutor(max_workers=4)as pool:batches=list(pool.map(get,queries))
    tracks={t['soundcloudUrn']:t for batch,_,_ in batches for t in batch}
    errors=sorted(set(e for _,_,codes in batches for e in codes))
    result=[];seen=set()
    # Round-robin artists instead of sorting the entire page by plays.
    buckets=[list(batch)for batch,_,_ in batches]
    while any(buckets):
        for bucket in buckets:
            if not bucket:continue
            t=bucket.pop(0)
            artist=scene_artist(t['artist']);artist=(artist['name']if artist else t['artist']).casefold()
            title=re.sub(r'\([^)]*\)|\[[^]]*\]','',t['title'].casefold())
            work_key=(artist,re.sub(r'[^\w]','',title))
            if work_key not in seen:seen.add(work_key);result.append(t)
    MODE_DIAGNOSTICS[kind+':'+str(offset)]={'queries':queries,'raw':sum(n for _,n,_ in batches),'accepted':len(result),'errors':errors,'artists':artist_stats}
    if not result and errors:
        if 'soundcloud_rate_limited'in errors:raise APIError(429,'soundcloud_rate_limited')
        raise APIError(502,'mode_sources_unavailable')
    data={'tracks':result,'hasMore':(offset+1)*2<len(CHILL_ARTISTS)if kind=='night'else offset+1<len(TREND_PAGES),'nextOffset':offset+1,'selection':'soundcloud-metadata'}
    DISCOVERY_CACHE[key]=(time.time()+(600 if result else 30),data)
    return data

"""Shared metadata request budget. Playback/CDN traffic has a separate path."""
import copy
from contextlib import contextmanager
from email.utils import parsedate_to_datetime
METADATA_CACHE={};METADATA_FLIGHTS={};METADATA_ERRORS={}
METADATA_LOCK=threading.RLock();METADATA_SLOTS=threading.BoundedSemaphore(2)
METADATA_NEXT=0.0;SOUNDCLOUD_RETRY_AT=0.0;STREAM_RETRY_AT=0.0;RATE_WINDOWS={};LAST_RATE_LIMIT={}
REQUEST_STATS={'network':0,'cache_hits':0,'coalesced':0,'rate_limits':0}
def observe_rate(url,headers,status):
    path=urlsplit(url).path
    group='oauth'if path.endswith('/oauth/token')else 'stream'if path.endswith(('/stream','/streams'))else 'metadata'
    entry={'status':status,'observedAt':int(time.time()),'endpoint':path}
    for name,header in [('limit','X-Ratelimit-Limit'),('remaining','X-Ratelimit-Remaining'),('resetAt','X-Ratelimit-Reset')]:
        try:entry[name]=int(float(headers.get(header,'')))
        except (ValueError,TypeError):pass
    with METADATA_LOCK:
        RATE_WINDOWS[group]=entry
        if status==429:LAST_RATE_LIMIT[group]=entry
    if status==429:print('SoundCloud HTTP 429 '+json.dumps({'group':group,**entry}),flush=True)
_raw_json_request=json_request
def json_request(url,data=None,headers=None):
    global SOUNDCLOUD_RETRY_AT,STREAM_RETRY_AT
    if urlsplit(url).path.endswith('/oauth/token')and SOUNDCLOUD_RETRY_AT>time.time()and RATE_WINDOWS.get('oauth',{}).get('status')==429:raise APIError(429,'soundcloud_rate_limited')
    try:return _raw_json_request(url,data,headers)
    except APIError as e:
        if e.status==429:
            with METADATA_LOCK:
                retry_at=time.time()+getattr(e,'retry_after',60)
                if urlsplit(url).path.endswith(('/streams','/stream'))and retry_at>time.time()+120:STREAM_RETRY_AT=max(STREAM_RETRY_AT,retry_at)
                else:SOUNDCLOUD_RETRY_AT=max(SOUNDCLOUD_RETRY_AT,retry_at)
                REQUEST_STATS['rate_limits']+=1
        raise

_uncached_api=api
@contextmanager
def metadata_slot():
    if not METADATA_SLOTS.acquire(timeout=8):raise APIError(503,'catalog_busy')
    try:yield
    finally:METADATA_SLOTS.release()
def api(path,params=None):
    global METADATA_NEXT,SOUNDCLOUD_RETRY_AT
    # Cached metadata never contains OAuth tokens, signed stream links or audio.
    metadata=path=='/tracks' or path.startswith('/users')
    if not metadata:
        if path.endswith(('/streams','/stream'))and STREAM_RETRY_AT>time.time():raise APIError(429,'soundcloud_rate_limited')
        return _uncached_api(path,params)
    requested=None
    if path=='/tracks' and (params or {}).get('q'):
        params=dict(params)
        try:requested=max(1,int(params.get('limit',50)))
        except (ValueError,TypeError):requested=50
        if requested<=50:params['limit']=50
    def project(value):
        value=copy.deepcopy(value)
        if requested and isinstance(value,dict) and len(value.get('collection',[]))>requested:
            value['collection']=value['collection'][:requested];value['next_href']='cached-more'
        return value
    key=(path,json.dumps(params or {},sort_keys=True,ensure_ascii=False))
    while True:
        with METADATA_LOCK:
            now=time.time();cached=METADATA_CACHE.get(key)
            if cached and cached[0]>now:
                REQUEST_STATS['cache_hits']+=1;return project(cached[2])
            if SOUNDCLOUD_RETRY_AT>now:
                if cached and cached[1]>now:return project(cached[2])
                error=APIError(429,'soundcloud_rate_limited');error.retry_after=max(1,int(SOUNDCLOUD_RETRY_AT-now));raise error
            failure=METADATA_ERRORS.get(key)
            if failure and failure[0]>now:
                if cached and cached[1]>now:return project(cached[2])
                raise APIError(failure[1],failure[2])
            flight=METADATA_FLIGHTS.get(key)
            if flight is None:
                if len(METADATA_FLIGHTS)>=12:raise APIError(503,'catalog_busy')
                flight=threading.Event();METADATA_FLIGHTS[key]=flight;break
            REQUEST_STATS['coalesced']+=1
        if not flight.wait(25):raise APIError(503,'catalog_busy')
    try:
        with metadata_slot():
            with METADATA_LOCK:
                if SOUNDCLOUD_RETRY_AT>time.time():raise APIError(429,'soundcloud_rate_limited')
                delay=max(0,METADATA_NEXT-time.monotonic());METADATA_NEXT=max(METADATA_NEXT,time.monotonic())+1.3
            if delay:time.sleep(delay)
            with METADATA_LOCK:
                if SOUNDCLOUD_RETRY_AT>time.time():raise APIError(429,'soundcloud_rate_limited')
                REQUEST_STATS['network']+=1
            value=_uncached_api(path,params)
        with METADATA_LOCK:
            METADATA_CACHE[key]=(time.time()+21600,time.time()+86400,copy.deepcopy(value));METADATA_ERRORS.pop(key,None)
            if len(METADATA_CACHE)>512:
                for old in list(METADATA_CACHE)[:128]:METADATA_CACHE.pop(old,None)
        return project(value)
    except APIError as e:
        with METADATA_LOCK:
            if e.status==429 and SOUNDCLOUD_RETRY_AT<=time.time():SOUNDCLOUD_RETRY_AT=time.time()+getattr(e,'retry_after',60)
            METADATA_ERRORS[key]=(time.time()+15,e.status,e.code)
            if len(METADATA_ERRORS)>512:
                for old in list(METADATA_ERRORS)[:128]:METADATA_ERRORS.pop(old,None)
            cached=METADATA_CACHE.get(key)
            if cached and cached[1]>time.time():return project(cached[2])
        raise
    finally:
        with METADATA_LOCK:METADATA_FLIGHTS.pop(key,None);flight.set()

# Standardize artist searches so foreground, recommendations and collections share results.
_search_before_budget=search
def search(query,offset=0,limit=25):
    if query=='telefy:requests:diagnostics':
        return {'requests':dict(REQUEST_STATS),'retryAfter':max(0,int(SOUNDCLOUD_RETRY_AT-time.time())),'streamRetryAfter':max(0,int(STREAM_RETRY_AT-time.time())),'metadataCacheEntries':len(METADATA_CACHE),'limits':dict(RATE_WINDOWS),'lastRateLimit':dict(LAST_RATE_LIMIT)}
    return _search_before_budget(query,offset,limit)

_discovery_before_budget=discovery
DISCOVERY_LAST_GOOD={}
def discovery(kind,offset=0):
    key=(kind,int(offset))
    try:
        data=_discovery_before_budget(kind,offset)
        if data.get('tracks'):DISCOVERY_LAST_GOOD[key]=(time.time(),data)
        return data
    except APIError:
        previous=DISCOVERY_LAST_GOOD.get(key)
        if previous and time.time()-previous[0]<86400:return {**previous[1],'stale':True}
        raise

# Bounded editorial + independently verified small-profile batch, shared for six hours.
_freshmen_before_budget=freshmen
FRESHMEN_LAST_GOOD={}
def freshmen(offset=0):
    import random
    batch=max(0,min(int(offset),9));period=int(time.time()//21600);key=('bounded',period,batch)
    with FRESHMEN_LOCK:
        saved=FRESHMEN_CACHE.get(key)
        if saved and saved[0]>time.time():return saved[1]
    rotation=random.Random(period).sample(SCENE_ROSTER,len(SCENE_ROSTER));result=[];errors=[]
    for cfg in rotation[batch*2:batch*2+2]:
        try:
            choices=search(cfg['name'],0,50)['tracks']
            choices=[t for t in choices if scene_matches(t['artist'],cfg) and rap_candidate(t)]
            for item in choices[:3]:result.append({**item,'editorialPick':True,'editorialArtist':cfg['name']})
        except APIError as e:
            errors.append(e.code)
            if e.status==429:break
    # One search and one bulk user lookup; no fan-out to 32 user catalogs.
    if not errors:
        try:
            raw=api('/tracks',{**FRESHMEN_SOURCES[batch%len(FRESHMEN_SOURCES)],'limit':50,'access':'playable','linked_partitioning':'true'})
            songs=raw.get('collection',[])if isinstance(raw,dict)else raw
            candidates=[];urns=[]
            for item in songs:
                user=item.get('user')or {};urn=user.get('urn')or ('soundcloud:users:'+str(user.get('id','')))
                if not re.fullmatch(r'soundcloud:users:\d+',urn):continue
                if not re.search('[а-яё]',str(item.get('title',''))+' '+str(item.get('metadata_artist',''))):continue
                if urn not in urns and len(urns)>=10:continue
                if urn not in urns:urns.append(urn)
                candidates.append((urn,item))
            if urns:
                raw_users=api('/users',{'urns':','.join(urns)})
                users=raw_users.get('collection',[])if isinstance(raw_users,dict)else raw_users
                profiles={u.get('urn')or ('soundcloud:users:'+str(u.get('id',''))):u for u in users}
                for urn,item in candidates:
                    u=profiles.get(urn,{})
                    if not isinstance(u.get('followers_count'),int)or not 5000<=u['followers_count']<=10000:continue
                    if item.get('access')!='playable' or not item.get('streamable'):continue
                    try:t=normalize_track(item)
                    except APIError:continue
                    if not rap_candidate(t)or re.search(r'шансон|пацан|блатн|chanson',t['title']+' '+t['genre'],re.I):continue
                    result.append({**t,'freshmanFollowers':u['followers_count'],'freshmanProfile':urn})
        except APIError as e:errors.append(e.code)
    result=list({t['soundcloudUrn']:t for t in result}.values())[:24]
    FRESHMEN_DIAGNOSTICS[batch]={'accepted':len(result),'errors':errors,'bounded':True,'period':period}
    if not result and errors:
        old=FRESHMEN_LAST_GOOD.get(batch)
        if old and time.time()-old[0]<86400:return {**old[1],'stale':True}
        raise APIError(429 if 'soundcloud_rate_limited'in errors else 502,errors[0])
    data={'tracks':result,'period':period,'hasMore':batch<9,'nextOffset':batch+1,'metric':'followers-or-editorial'}
    with FRESHMEN_LOCK:
        FRESHMEN_CACHE[key]=((period+1)*21600 if result else time.time()+30,data)
        if len(FRESHMEN_CACHE)>24:
            for old in list(FRESHMEN_CACHE):
                if old[0]=='bounded'and old[1]<period-1:FRESHMEN_CACHE.pop(old,None)
    if result:FRESHMEN_LAST_GOOD[batch]=(time.time(),data)
    return data

"""Durable application OAuth session; serialized refresh across service instances."""
_file_access_token=access_token
OAUTH_STORAGE={'backend':'file','state':'idle','storeVersion':2}
OAUTH_TABLE_READY=False
def _durable_access_token(invalidate=None,credentials=None):
    global OAUTH_TABLE_READY
    cfg=credentials or settings()
    if not os.environ.get('DATABASE_URL'):
        return _file_access_token(invalidate,credentials)
    from user_database import UserDatabase
    fingerprint=hashlib.sha256((cfg['client_id']+'\0'+cfg['client_secret']).encode()).hexdigest()
    error=None;result=None
    try:
        db=UserDatabase()
        with db.connect()as conn:
            if not OAUTH_TABLE_READY:
                # This module owns its migration; old profile schemas remain compatible.
                if db.url:db.execute(conn,'SELECT pg_advisory_xact_lock(734620106)')
                db.execute(conn,'CREATE TABLE IF NOT EXISTS telefy_service_sessions (service_key TEXT PRIMARY KEY,session_json TEXT NOT NULL,retry_at BIGINT NOT NULL DEFAULT 0)')
            db.execute(conn,'INSERT INTO telefy_service_sessions(service_key,session_json,retry_at) VALUES(%s,%s,%s) ON CONFLICT(service_key) DO NOTHING',('soundcloud:'+fingerprint,'{}',0))
            row=db.execute(conn,'SELECT session_json,retry_at FROM telefy_service_sessions WHERE service_key=%s FOR UPDATE',('soundcloud:'+fingerprint,)).fetchone()
            stored=json.loads(row['session_json']);local=read_json(DATA/'soundcloud-session.json')
            # Migrate an existing file into durable storage on the first successful request.
            if local.get('fingerprint')==fingerprint and (local.get('expires_at',0)>stored.get('expires_at',0) or not stored.get('refresh_token')):stored=local
            if stored.get('access_token')and stored.get('expires_at',0)>time.time()+60 and stored['access_token']!=invalidate:
                write_json(DATA/'soundcloud-session.json',stored);result=stored['access_token']
                db.execute(conn,'UPDATE telefy_service_sessions SET session_json=%s,retry_at=0 WHERE service_key=%s',(json.dumps(stored),'soundcloud:'+fingerprint))
                OAUTH_STORAGE.update(backend='postgres',state='reused')
            elif row['retry_at']>time.time():
                error=APIError(429,'soundcloud_rate_limited');error.retry_after=int(row['retry_at']-time.time())
                OAUTH_STORAGE.update(backend='postgres',state='cooldown',retryAt=row['retry_at'])
            else:
                if stored.get('access_token')or stored.get('refresh_token'):write_json(DATA/'soundcloud-session.json',stored)
                try:
                    result=_file_access_token(invalidate,credentials)
                    session=read_json(DATA/'soundcloud-session.json')
                    if not session.get('access_token'):raise APIError(503,'oauth_storage_unavailable')
                    db.execute(conn,'UPDATE telefy_service_sessions SET session_json=%s,retry_at=0 WHERE service_key=%s',(json.dumps(session),'soundcloud:'+fingerprint))
                    OAUTH_STORAGE.update(backend='postgres',state='saved')
                except APIError as e:
                    error=e
                    if e.status==429:
                        retry_at=int(time.time()+getattr(e,'retry_after',60))
                        db.execute(conn,'UPDATE telefy_service_sessions SET session_json=%s,retry_at=%s WHERE service_key=%s',(json.dumps(stored),retry_at,'soundcloud:'+fingerprint))
                        OAUTH_STORAGE.update(backend='postgres',state='cooldown',retryAt=retry_at)
        OAUTH_TABLE_READY=True
    except APIError:raise
    except Exception as failure:
        reason=('sql_'+failure.sqlstate)if getattr(failure,'sqlstate',None)else type(failure).__name__
        OAUTH_STORAGE.update(backend='postgres',state='storage_unavailable',reason=reason)
        print('OAuth storage failure '+json.dumps({'reason':reason,'storeVersion':2}),flush=True)
        # Reusing an already valid local token does not issue another grant.
        local=read_json(DATA/'soundcloud-session.json')
        if local.get('fingerprint')==fingerprint and local.get('expires_at',0)>time.time()+60 and local.get('access_token')and local['access_token']!=invalidate:
            OAUTH_STORAGE.update(backend='file',state='reused_during_database_failure')
            return local['access_token']
        # Do not fall back to repeated client_credentials exchanges if durable storage fails.
        raise APIError(503,'oauth_storage_unavailable')from None
    if error:raise error
    return result

def access_token(invalidate=None,credentials=None):
    with LOCK:return _durable_access_token(invalidate,credentials)

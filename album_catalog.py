"""SoundCloud albums/EPs, with two explicitly selected editorial releases."""
import re,time,threading,json
from pathlib import Path
from urllib.parse import quote,urlsplit,parse_qs
LOCK=threading.RLock();CACHE={};BROWSE_LOCK=threading.Lock();BROWSE={}
PINS=[{'url':'https://soundcloud.com/members-only-forever/sets/12-ep','title':'12+ (EP)','artist':'i61 & stereoRYZE','year':'2017','keys':'i61 stereoRYZE 12+ 12 ep голыедети мне очень весело мононоке санандреас'}, {'url':'https://soundcloud.com/pharaohdd/sets/red-um-dullboy-ep','title':'REDЯUM (DULLBOY EP)','artist':'PHARAOH','year':'2019','keys':'pharaoh фара redяum redrum redum dullboy никакой любви фул клип enfants rich убийца узы моба'}]
OG_PINS=[{'url':'https://soundcloud.com/ogbuda/sets/freerio-2','title':'FREERIO','artist':'OG Buda','year':'2021','keys':'freerio фририо OG Buda буда'},{'url':'https://soundcloud.com/ogbuda/sets/freerio-3-2','title':'FREERIO 3','artist':'OG Buda','year':'2023','keys':'freerio 3 фририо OG Buda буда'},{'url':'https://soundcloud.com/ogbuda/sets/gbqqtyuwtqzv','title':'ОПГ СИТИ','artist':'OG Buda','year':'2019','keys':'опг сити opg city OG Buda буда'}]
for pin,urn,cover in zip(OG_PINS,['soundcloud:playlists:1269973384','soundcloud:playlists:1957256741','soundcloud:playlists:1269973471'],['https://i1.sndcdn.com/artworks-41f11c63-3045-43b3-97f3-aad957dc862c-0-t500x500.jpg','https://i1.sndcdn.com/artworks-00ed4585-c6b7-4a28-a2a7-df3b451779bb-0-t500x500.jpg','https://i1.sndcdn.com/artworks-f57b83e0-0da1-4f1c-8d5b-44c767258cc4-0-t500x500.jpg']):pin.update(urn=urn,coverImg=cover)
PINS+=OG_PINS
STARTER=[('PHARAOH','Фосфор','2016'),('PHARAOH','Pink Phloyd','2017'),('PHARAOH','PHUNERAL','2018'),('PHARAOH','Правило','2020'),('Boulevard Depo','RAPP2','2018'),('Boulevard Depo','OLD BLOOD','2020'),('ЛСП','Magic City','2015'),('ЛСП','Трагик Сити','2017'),('Big Baby Tape','Dragonborn','2018'),('Big Baby Tape','VARSKVA','2023'),('KIZARU','Karmageddon','2019'),('KIZARU','Born To Trap','2020'),('OG Buda','ОПГ СИТИ','2019'),('FRIENDLY THUG 52 NGG','Cristoforo Colombo','2023'),('Kai Angel & 9mice','HEAVY METAL','2023'),('MORGENSHTERN','Легендарная пыль','2020')]
ARTIST_PROFILES={'pharaoh':'https://soundcloud.com/deaddynastyph','ogbuda':'https://soundcloud.com/ogbuda'}
AUTHOR_RELEASES={'pinkphloyd':'https://soundcloud.com/deaddynastyph/sets/pink-phloyd','phuneral':'https://soundcloud.com/deaddynastyph/sets/phuneral','правило':'https://soundcloud.com/deaddynastyph/sets/pravilo','milliondollardepression':'https://soundcloud.com/deaddynastyph/sets/million-dollar-depression'}
def key(value):return re.sub(r'[^\w]','',str(value).casefold().replace('ё','е'))

EDITORIAL=[{'artist':'PHARAOH & i61','title':'RAGE MODE','year':'2015','aliases':['Rage Mode (Rare Action)']},{'artist':'Whole Lotta Swag','title':'First Day In Therapy','year':'2026','aliases':[]},{'artist':'Kai Angel','title':'damage','year':'2025','aliases':[]},{'artist':'Kai Angel','title':'Shh...','year':'2026','aliases':['Shh…']},{'artist':'Kai Angel','title':'Shh!','year':'2026','aliases':[]}]
EDITORIAL += [{'artist':'OG Buda','title':title,'year':year,'aliases':[]}for title,year in [('FREERIO 2','2022')]]
EDITORIAL_IDS={}
def title_key(value):
 value=str(value).strip().casefold().replace('…','...')
 return 'shh_bang'if value=='shh!'else'shh_ellipsis'if value=='shh...'else key(value)

def editorial_search(sc,query):
 q=key(query);result=[]
 for release in EDITORIAL:
  if len(q)<2 or not any(q in key(text)or key(text)in q for text in [release['title'],release['artist'],*release['aliases']]):continue
  cache_key=('editorial_release_v1',release['artist'],release['title'])
  def lookup():
   raw=sc.api('/playlists',{'q':release['artist']+' '+release['title'],'limit':50,'linked_partitioning':'true'})
   rows=raw.get('collection',[])if isinstance(raw,dict)else raw;matches=[]
   for row in rows:
    title=clean_title(row.get('title',''),release['artist'])
    for artist in release['artist'].split(' & '):title=clean_title(title,artist)
    if title_key(title)not in{title_key(release['title']),*[title_key(a)for a in release['aliases']]}:continue
    if not any(credited_to(sc,row,a)for a in release['artist'].split(' & ')):continue
    if int(row.get('track_count')or len(row.get('tracks')or[]))<2:continue
    album=normal(sc,row,release);matches.append(album)
   return sorted(matches,key=lambda a:a['trackCount'],reverse=True)[:1]
  try:found=cached(cache_key,lookup)
  except sc.APIError:continue
  for album in found:EDITORIAL_IDS[album['id']]=release;result.append(album)
 return result
def clean_title(title,artist):
 title=str(title).strip();title=re.sub(r'^'+re.escape(artist)+r'\s*[-–—:]\s*','',title,flags=re.I)
 title=re.sub(r'\s*[\[(](?:album|альбом|full album|official|\d{1,2}[./-]\d{1,2}[./-]\d{4})[^\])]*[\])]','',title,flags=re.I)
 title=re.sub(r'\s*[\[(](?:(?:19|20)\d{2}|explicit|clean)[\])]','',title,flags=re.I)
 return re.sub(r'\s+',' ',title).strip()
def release_key(album):return key(album['artist'])+':'+title_key(clean_title(album['title'],album['artist']))
def dedupe(albums):
 result={}
 for album in albums:
  identity=release_key(album);old=result.get(identity)
  if old is None or(bool(album.get('coverImg')),album.get('trackCount',0))>(bool(old.get('coverImg')),old.get('trackCount',0)):result[identity]=album
 return list(result.values())
def cached(key,call):
 with LOCK:
  hit=CACHE.get(key)
  if hit and hit[0]>time.time():return hit[1]
 # Source API already provides request budgeting; errors are not cached.
 value=call()
 with LOCK:
  if len(CACHE)>256:CACHE.clear()
  CACHE[key]=(time.time()+21600,value)
 return value
def normal(sc,raw,pin=None):
 user=raw.get('user')or{};urn=str(raw.get('urn')or'soundcloud:playlists:'+str(raw.get('id','')))
 if not re.fullmatch(r'soundcloud:playlists:\d+',urn):raise sc.APIError(502,'invalid_album')
 if not pin:
  for release in EDITORIAL:
   title=clean_title(raw.get('title',''),release['artist'])
   if title_key(title)in{title_key(release['title']),*[title_key(a)for a in release['aliases']]} and any(credited_to(sc,raw,a)for a in release['artist'].split(' & ')):
    pin=release;break
 artist=(pin or{}).get('artist')or str((raw.get('publisher_metadata')or{}).get('artist')or user.get('username')or'');title=(pin or{}).get('title')or str(raw.get('title')or'')
 known_title=next((s for s in STARTER if key(clean_title(title,s[0]))==key(s[1])),None)
 if not pin and known_title:artist=known_title[0]
 for candidate in roster(sc):
  if re.match(r'^'+re.escape(candidate)+r'\s*[-–—:]\s*',title,re.I):artist=candidate;break
 title=clean_title(title,artist);known=next((s for s in STARTER if key(s[0])==key(artist)and key(s[1])==key(title)),None)
 return {'id':urn,'title':title,'artist':artist,'year':(pin or{}).get('year')or(known[2]if known else str(raw.get('release_year')or str(raw.get('release_date')or'')[:4])),'coverImg':sc.safe_url(raw.get('artwork_url')).replace('-large.','-t500x500.')or sc.safe_url((raw.get('tracks')or[{}])[0].get('artwork_url')),'url':sc.safe_url(raw.get('permalink_url'))or(pin or{}).get('url',''),'trackCount':int(raw.get('track_count')or len(raw.get('tracks')or[]))}
def resolve_pin(sc,pin):
 if pin.get('urn'):return cached(('approved_release_v5',pin['urn']),lambda:load_approved_release(sc,pin))
 return cached(pin['url'],lambda:sc.api('/resolve',{'url':pin['url']}))

def track_key(title,artist=''):
 title=re.sub(r'\s*[\[(](?:feat\.?|ft\.?|prod\.?|produced|bonus|explicit|official).*','',title,flags=re.I)
 title=re.sub(r'\s+(?:feat\.?|ft\.?)\s+.*','',title,flags=re.I)
 title=re.sub(r'^'+re.escape(artist)+r'\s*[-–—:]\s*','',title,flags=re.I)if artist else title
 return key(title)

def validate_release(sc,album,tracks,recover):
 # Exact user-approved original SoundCloud sets define their own membership/order.
 if any(p['url']==album.get('url')for p in OG_PINS):return tracks
 reference=next((r for r in REFERENCES.values()if key(r['artist'])==key(album['artist'])and title_key(r['title'])==title_key(album['title'])),None)
 if not reference:
  if any(p['url']==album.get('url')for p in PINS):return tracks
  # Unknown releases must consistently credit the artist, not just share a title.
  allowed={key(album['artist'])}|{key(p) for p in re.split(r'[,&/]',album['artist'])}
  for artist in canonical_roster(sc):
   if key(artist['name'])in allowed:allowed.update(key(a)for a in artist['aliases'])
  accepted=[t for t in tracks if any(key(p)in allowed for p in re.split(r'[,&/]|\s+feat\.?\s+',str(t.get('primaryArtist')or t.get('artist')or''),flags=re.I))]
  if len(accepted)!=len(tracks):raise sc.APIError(404,'album_source_mismatch')
  return tracks
 artist=reference['artist'];slots=reference['tracks'];bytitle={}
 def accept(track,slot):
  if track_key(track.get('title',''),artist)!=track_key(slot['title']):return False
  credit=key(track.get('primaryArtist')or track.get('artist')or'');expected=[key(p)for p in re.split(r'[,&/]',slot['artist'])]+[key(artist)]
  if key(artist)=='лсп':expected+=['lsp','лсп']
  if not any(p and p in credit for p in expected)and not str(track.get('title','')).casefold().startswith(artist.casefold()):return False
  duration=float(track.get('duration')or 0);return not duration or abs(duration-slot['duration'])<=max(12,slot['duration']*.15)
 for slot in slots:
  matches=[t for t in tracks if accept(t,slot)]
  if matches:bytitle[slot['number']]=matches[0]
 if recover:
  from concurrent.futures import ThreadPoolExecutor
  def find(slot):
   try:
    data=cached(('album_exact_track_v2',artist,slot['title']),lambda:sc._search_before_albums(artist+' '+slot['title'],0,15))
    return slot,next((t for t in data.get('tracks',[])if accept(t,slot)),None)
   except sc.APIError as error:
    if error.status in(403,404):return slot,None
    raise
  with ThreadPoolExecutor(max_workers=2)as pool:
   for slot,track in pool.map(find,[r for r in slots if r['number']not in bytitle]):
    if track:bytitle[slot['number']]=track
 result=[]
 for slot in slots:
  if slot['number']not in bytitle:continue
  track=dict(bytitle[slot['number']]);track.update(album=album['title'],collectionId=album['id'],releaseYear=album['year']);result.append(track)
 album.update(expectedTrackCount=len(slots),availableTrackCount=len(result),complete=len(result)==len(slots),missingTitles=[r['title']for r in slots if r['number']not in bytitle],verifiedTracklist=True)
 return result
def detail(sc,identity,recover=True):
 pin=next((p for p in PINS if p['url']==identity or p.get('urn')==identity),None)
 if pin:raw=resolve_pin(sc,pin)
 else:
  if not re.fullmatch(r'soundcloud:playlists:\d+',identity):raise sc.APIError(400,'invalid_album')
  raw=cached(identity,lambda:sc.api('/playlists/'+quote(identity,safe=''),{'show_tracks':'true'}))
  pin=next((p for p in PINS if p['url']==raw.get('permalink_url')),None)
 if not pin:
  candidate=normal(sc,raw,EDITORIAL_IDS.get(identity))
  pin=next((p for p in OG_PINS if release_key(p)==release_key(candidate)),None)
  if pin:raw=resolve_pin(sc,pin)
 album=normal(sc,raw,pin or EDITORIAL_IDS.get(identity));items=raw.get('tracks')or[]
 if len(items)<int(raw.get('track_count')or 0):
  fresh=cached(album['id']+':full',lambda:sc.api('/playlists/'+quote(album['id'],safe=''),{'show_tracks':'true'}));items=fresh.get('tracks')or[]
 missing=[str(t.get('id')or str(t.get('urn','')).split(':')[-1])for t in items if not t.get('title')or 'access'not in t or 'streamable'not in t]
 if missing:
  full=[]
  for start in range(0,len(missing),50):
   ids=missing[start:start+50];chunk=cached(('album_tracks',tuple(ids)),lambda:sc.api('/tracks',{'ids':','.join(ids)}));full.extend(chunk.get('collection',[])if isinstance(chunk,dict)else chunk)
  byid={str(t.get('id')or str(t.get('urn','')).split(':')[-1]):t for t in full};items=[byid.get(str(t.get('id')or str(t.get('urn','')).split(':')[-1]),t)for t in items]
 tracks=[]
 for item in items:
  if item.get('access')!='playable'or not item.get('streamable'):continue
  try:track=sc.normalize_track(item)
  except sc.APIError:continue
  track.update(album=album['title'],collectionId=album['id'],releaseYear=album['year']);tracks.append(track)
 if not album['coverImg']and tracks:album['coverImg']=tracks[0]['coverImg']
 tracks=validate_release(sc,album,tracks,recover)
 album['trackCount']=len(tracks)
 if not tracks:raise sc.APIError(404,'album_no_playable_tracks')
 return {'album':album,'tracks':tracks,'hasMore':False}

def starter(sc,page):
 albums=[];start=page*2
 for artist,title,year in STARTER[start:start+2]:
  authoritative=next((p['url']for p in OG_PINS if key(p['title'])==key(title)),None)if key(artist)=='ogbuda'else AUTHOR_RELEASES.get(key(title))if key(artist)=='pharaoh'else None
  if authoritative:
   try:
    raw=cached(authoritative,lambda:sc.api('/resolve',{'url':authoritative}));identity=normal(sc,raw)['id'];data=cached(('validated_album',identity),lambda:detail(sc,identity,False));album=dict(data['album']);album.update(title=title,artist=artist,year=year);albums.append(album)
   except sc.APIError as e:
    if e.status not in(403,404):raise
   continue
  raw=cached(('starter',artist,title),lambda:sc.api('/playlists',{'q':artist+' '+title,'limit':25,'linked_partitioning':'true'}));rows=raw.get('collection',[])if isinstance(raw,dict)else raw
  candidates=[]
  for row in rows:
   try:a=normal(sc,row)
   except sc.APIError:continue
   if key(clean_title(a['title'],artist))!=key(title)or key(artist)not in key(a['artist']+' '+str(row.get('title',''))):continue
   candidates.append(a)
  for a in sorted(candidates,key=lambda a:(bool(a['coverImg']),a['trackCount']),reverse=True)[:3]:
   try:data=cached(('validated_album',a['id']),lambda:detail(sc,a['id'],False))
   except sc.APIError as e:
    if e.status in(403,404):continue
    raise
   a=data['album'];a.update(title=title,artist=artist,year=year);albums.append(a);break
 return {'albums':dedupe(albums),'tracks':[],'hasMore':start+2<len(STARTER),'nextOffset':page+1,'targetCount':16,'starter':True}

def roster(sc):
 names=['PHARAOH','madk1d','Kai Angel','9mice','Villian','OG Buda','Big Baby Tape','KIZARU','FORTUNA 812']
 names += [r['name']for r in getattr(sc,'SCENE_ROSTER',[])]+list(getattr(sc,'LEGENDS_ARTISTS',[]))+list(getattr(sc,'HITS_ADDITIONS',[]))+list(getattr(sc,'CHILL_ARTISTS',[]))+['i61','stereoRYZE']
 for file in ['hits-approved.json','legends-approved.json']:
  path=Path(__file__).with_name(file)
  if path.exists():
   config=json.loads(path.read_text(encoding='utf-8'))
   names += [row['artist']for key in ['tracks','albums']for row in config.get(key,[])if row.get('artist')]
 seen=set();result=[]
 for name in names:
  key=re.sub(r'[^\w]','',str(name).casefold())
  if key and key not in seen:seen.add(key);result.append(str(name))
 return result

def is_release(raw):
 if raw.get('track_count')==0:return False
 if re.search(r'(?i)\b(?:remix(?:es)?|tribute|karaoke|sped.?up|slowed)\b|ремикс',str(raw.get('title')or'')):return False
 if raw.get('is_album')is True or raw.get('set_type')in('album','ep','single','compilation'):return True
 # Some SoundCloud releases are uploaded as ordinary sets with an explicit EP/LP title.
 return bool(re.search(r'(?i)(?:\b(?:ep|lp|album|mixtape)\b|альбом)',str(raw.get('title')or'')))

def canonical_roster(sc):
 result={}
 for name in roster(sc):
  for part in re.split(r'\s+(?:&|feat\.?)\s+|,\s*',name,flags=re.I):
   if key(part):result.setdefault(key(part),{'name':part,'aliases':[part]})
 for row in getattr(sc,'SCENE_ROSTER',[]):
  result[key(row['name'])]={'name':row['name'],'aliases':[row['name']]+row.get('aliases',[])}
 return list(result.values())

def credited_to(sc,raw,artist):
 aliases=next((r['aliases']for r in canonical_roster(sc)if key(r['name'])==key(artist)),[artist]);allowed={key(a)for a in aliases}
 values=[(raw.get('publisher_metadata')or{}).get('artist'),(raw.get('user')or{}).get('username')]
 values += [t.get('metadata_artist')or(t.get('publisher_metadata')or{}).get('artist')or(t.get('user')or{}).get('username')for t in(raw.get('tracks')or[])[:10]]
 for value in values:
  if any(key(part.strip(' ()'))in allowed for part in re.split(r'\s+(?:feat\.?|ft\.?|featuring)\s+|[,&/]',str(value or''),flags=re.I)):return True
 return any(re.match(r'^'+re.escape(alias)+r'\s*[-–—:]\s*',str(raw.get('title')or''),re.I)for alias in aliases)

def artist_search(sc,query,offset):
 q=key(query);rows=canonical_roster(sc);matches=[r for r in rows if not q or any(q in key(alias)for alias in r['aliases'])]
 if hasattr(sc,'smart_queries')and q:
  _,names=sc.smart_queries(query);wanted={key(n)for n in names};matches=[r for r in rows if r in matches or key(r['name'])in wanted]
 if q:matches.sort(key=lambda r:(0 if key(r['name'])==q else 1,len(r['name'])))
 output=[]
 for row in matches[offset:offset+20]:
  name=row['name'];cover=''
  if q and len(output)<2:
   try:
    if key(name)in ARTIST_PROFILES:profile=cached(('artist_profile',key(name)),lambda:sc.api('/resolve',{'url':ARTIST_PROFILES[key(name)]}));cover=sc.safe_url(profile.get('avatar_url'))
    else:
     raw=cached(('canonical_users',key(name)),lambda:sc.api('/users',{'q':name,'limit':25}));users=raw.get('collection',[])if isinstance(raw,dict)else raw
     exact=[u for u in users if key(u.get('username'))in{key(alias)for alias in row['aliases']}]
     if exact:cover=sc.safe_url(max(exact,key=lambda u:(u.get('verified')is True,int(u.get('followers_count')or 0))).get('avatar_url'))
   except sc.APIError:pass
  output.append({'id':'telefy:artist:'+key(name),'name':name,'coverImg':cover})
 return {'artists':output,'tracks':[],'hasMore':offset+20<len(matches),'nextOffset':offset+20}

def profile_releases(sc,name,offset):
 profile=cached(('artist_profile',key(name)),lambda:sc.api('/resolve',{'url':ARTIST_PROFILES[key(name)]}))
 urn=str(profile.get('urn')or'soundcloud:users:'+str(profile.get('id','')))
 if not re.fullmatch(r'soundcloud:users:\d+',urn):raise sc.APIError(502,'invalid_artist_profile')
 raw=cached(('profile_releases',urn,offset),lambda:sc.api('/users/'+quote(urn,safe='')+'/playlists',{'limit':50,'offset':offset,'linked_partitioning':'true'}))
 rows=raw.get('collection',[])if isinstance(raw,dict)else raw;albums=[]
 for row in rows:
  if row.get('track_count',len(row.get('tracks')or[]))<=0:continue
  if re.search(r'(?i)remix|tribute|karaoke|slowed|sped|favorites|best of|любимое|лучшее',row.get('title')or''):continue
  try:albums.append(normal(sc,row,{'artist':name}))
  except sc.APIError:continue
 return {'albums':dedupe(albums),'tracks':[],'hasMore':bool(raw.get('next_href'))if isinstance(raw,dict)else len(rows)==50,'nextOffset':offset+50}

def browse(sc,page):
 names=roster(sc);period=int(time.time()//21600);key=(period,tuple(names))
 with BROWSE_LOCK:
  job=BROWSE.get(key)
  if job is None:
   BROWSE.clear();job={'pages':[],'queue':[(name,0)for name in names],'seen':set()};BROWSE[key]=job
  if page<len(job['pages']):return job['pages'][page]
  if page>len(job['pages']):raise sc.APIError(409,'album_catalog_cursor_expired')
  albums=[];warnings=[];requests=0
  while job['queue']and requests<3:
   artist,offset=job['queue'][0];requests+=1
   try:
    raw=cached(('albums',artist.casefold(),offset),lambda:sc.api('/playlists',{'q':artist,'limit':25,'offset':offset,'linked_partitioning':'true'}))
   except sc.APIError as error:
    if not albums:raise
    warnings.append(error.code);break
   job['queue'].pop(0);rows=raw.get('collection',[])if isinstance(raw,dict)else raw
   if isinstance(raw,dict)and raw.get('next_href'):job['queue'].append((artist,offset+25))
   for row in rows:
    if not is_release(row):continue
    user=row.get('user')or{};credit=' '.join([str(user.get('username')or''),str((row.get('publisher_metadata')or{}).get('artist')or''),str(row.get('title')or'')]+[str(t.get('metadata_artist')or(t.get('user')or{}).get('username')or'')for t in(row.get('tracks')or[])[:5]])
    norm=lambda value:re.sub(r'[^\w]','',str(value).casefold().replace('ё','е'))
    aliases=[artist]
    for cfg in getattr(sc,'SCENE_ROSTER',[]):
     if norm(cfg['name'])==norm(artist):aliases+=cfg.get('aliases',[])
    if not any(norm(alias)in norm(credit)for alias in aliases):continue
    pin=next((p for p in PINS if p['url']==row.get('permalink_url')),None)
    try:album=normal(sc,row,pin)
    except sc.APIError:continue
    if album['id']in job['seen']:continue
    if not pin and not(row.get('publisher_metadata')or{}).get('artist')and norm(artist)in norm(credit):album['artist']=artist
    job['seen'].add(album['id']);albums.append(album)
   if len(albums)>=8:break
  result={'albums':albums,'tracks':[],'hasMore':bool(job['queue']),'nextOffset':page+1,'catalogArtists':len(names)}
  if warnings:result['warnings']=warnings
  job['pages'].append(result);return result
def search(sc,query,offset=0,kind='albums'):
 query=str(query).strip()[:120];offset=max(0,min(int(offset),1000));items=[];more=False
 api_query=query
 if hasattr(sc,'smart_queries'):
  aliases,names=sc.smart_queries(query)
  if names and aliases:api_query=aliases[0]
 if kind=='albums'and not query:return starter(sc,offset)
 if kind=='artists':
  return artist_search(sc,query,offset)
 if key(query).startswith(('freerio','фририо','опгсити','opgcity')):
  return official_title_search(sc,'OG Buda',query,offset)
 if key(api_query)=='ogbuda':
  if offset==0:return {'albums':[approved_card(sc,p)for p in OG_PINS],'tracks':[],'hasMore':True,'nextOffset':1}
  data=profile_releases(sc,'OG Buda',offset-1);data['albums']=prefer_og_pins(sc,data['albums']);data['nextOffset']+=1;return data
 editorial=editorial_search(sc,query)if offset==0 else []
 if key(api_query)in ARTIST_PROFILES:
  data=profile_releases(sc,api_query,offset)
  if key(api_query)=='ogbuda':data['albums']=prefer_og_pins(sc,data['albums'],all_pins=offset==0)
  data['albums']=dedupe(data['albums']+[a for a in editorial if release_key(a)not in{release_key(b)for b in data['albums']}]);return data
 items.extend(editorial)
 for pin in PINS:
  if offset==0 and(not query or query.casefold()in pin['keys'].casefold()):items.append(normal(sc,resolve_pin(sc,pin),pin))
 if len(query)>=2:
  canonical=next((r['name']for r in canonical_roster(sc)if key(r['name'])==key(api_query)),None)
  if canonical and offset==0:
   with LOCK:
    for cache_key,entry in CACHE.items():
     if isinstance(cache_key,tuple)and cache_key[0]=='validated_album'and entry[0]>time.time():
      album=entry[1].get('album')or{}
      if key(album.get('artist'))==key(canonical):items.append(dict(album))
  cursor=offset;attempts=3 if canonical else 1
  for _ in range(attempts):
   raw=cached(('albums',api_query.casefold(),cursor),lambda:sc.api('/playlists',{'q':api_query,'limit':25,'offset':cursor,'linked_partitioning':'true'}));rows=raw.get('collection',[])if isinstance(raw,dict)else raw;more=bool(raw.get('next_href'))if isinstance(raw,dict)else len(rows)==25;cursor+=25
   for row in rows:
    if row.get('track_count',len(row.get('tracks')or[]))<=0:continue
    try:album=normal(sc,row)
    except sc.APIError:continue
    credit=' '.join([str(row.get('title')or''),str((row.get('user')or{}).get('username')or''),str((row.get('publisher_metadata')or{}).get('artist')or'')]+[str(t.get('metadata_artist')or(t.get('user')or{}).get('username')or'')for t in(row.get('tracks')or[])[:5]])
    relevant=not canonical or credited_to(sc,row,canonical)
    official_like=canonical and key((row.get('user')or{}).get('username'))==key(canonical)and row.get('track_count',len(row.get('tracks')or[]))>=3 and not re.search(r'(?i)remix|tribute|karaoke|slowed|sped|favorites|best of|любимое|лучшее|дискография',row.get('title')or'')
    known=next((seed for seed in STARTER if canonical and key(seed[0])==key(canonical)and key(clean_title(row.get('title',''),canonical))==key(seed[1])),None)
    if not relevant or not(is_release(row)or official_like or known):continue
    if canonical:album['artist']=canonical;album['title']=clean_title(album['title'],canonical)
    if known:album.update(title=known[1],year=known[2])
    items.append(album)
   items=dedupe(items)
   if not more or len(items)>=8:break
 else:cursor=offset
 return {'albums':dedupe(items),'tracks':[],'hasMore':more,'nextOffset':cursor}

REFERENCES={'PHARAOH|Фосфор': {'artist': 'PHARAOH', 'title': 'Фосфор', 'year': '2016', 'state': 'verified', 'source': 'https://music.apple.com/us/album/phosphor/1135431444?uo=4', 'referenceId': 1135431444, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/9c/d3/0e/9cd30e62-cff2-4504-b2d8-6e475ad96db0/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Сфагнум', 'artist': 'PHARAOH', 'duration': 80, 'number': 1}, {'title': 'Надеюсь у тебя нет аллергии на клубнику', 'artist': 'PHARAOH', 'duration': 136, 'number': 2}, {'title': 'Разложение', 'artist': 'PHARAOH', 'duration': 145, 'number': 3}, {'title': 'Выродок', 'artist': 'PHARAOH', 'duration': 153, 'number': 4}, {'title': 'Я помню, как мы сожгли письма у канала', 'artist': 'PHARAOH', 'duration': 138, 'number': 5}, {'title': 'Мой мрак (feat. Jeembo)', 'artist': 'PHARAOH', 'duration': 236, 'number': 6}, {'title': 'Псы всегда попадают в рай (feat. Acid Drop King)', 'artist': 'PHARAOH', 'duration': 184, 'number': 7}, {'title': 'Фосфор', 'artist': 'PHARAOH', 'duration': 159, 'number': 8}, {'title': 'Конечно оригинал, заказывал из штатов', 'artist': 'PHARAOH', 'duration': 149, 'number': 9}, {'title': 'Вальс (feat. Скриптонит)', 'artist': 'PHARAOH', 'duration': 208, 'number': 10}, {'title': 'Мотая на кисть (feat. Techno)', 'artist': 'PHARAOH', 'duration': 179, 'number': 11}, {'title': 'Вспоминая о светлом', 'artist': 'PHARAOH', 'duration': 159, 'number': 12}, {'title': 'Морион', 'artist': 'PHARAOH', 'duration': 147, 'number': 13}, {'title': 'Давай останемся дома', 'artist': 'PHARAOH', 'duration': 159, 'number': 14}, {'title': 'Ты, на луне, забери меня нахуй отсюда', 'artist': 'PHARAOH', 'duration': 133, 'number': 15}, {'title': 'Позволив молодости жить', 'artist': 'PHARAOH', 'duration': 165, 'number': 16}, {'title': 'Клюква', 'artist': 'PHARAOH', 'duration': 217, 'number': 17}, {'title': 'Зачем ты это слушаешь, выключи', 'artist': 'PHARAOH', 'duration': 122, 'number': 18}, {'title': 'ММ (Bonus Track)', 'artist': 'PHARAOH', 'duration': 132, 'number': 19}]}, 'PHARAOH|Pink Phloyd': {'artist': 'PHARAOH', 'title': 'Pink Phloyd', 'year': '2017', 'state': 'verified', 'source': 'https://music.apple.com/us/album/pink-phloyd/1257008616?uo=4', 'referenceId': 1257008616, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/54/a1/77/54a1776c-200a-5401-54d0-c264a51508ee/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Pink Phloyd', 'artist': 'PHARAOH', 'duration': 194, 'number': 1}, {'title': 'Проблемы (feat. The Chemodan)', 'artist': 'PHARAOH', 'duration': 255, 'number': 2}, {'title': 'Дико, например', 'artist': 'PHARAOH', 'duration': 168, 'number': 3}, {'title': 'Школа (feat. Morty Mort & 39)', 'artist': 'PHARAOH', 'duration': 198, 'number': 4}, {'title': 'Твоё место (feat. Acid Drop King)', 'artist': 'PHARAOH', 'duration': 163, 'number': 5}, {'title': 'Реквием по эго (Interlude)', 'artist': 'PHARAOH', 'duration': 128, 'number': 6}, {'title': 'Лаллипап', 'artist': 'PHARAOH', 'duration': 163, 'number': 7}, {'title': 'Louis Vuitton Kiss (feat. Boulevard Depo)', 'artist': 'PHARAOH', 'duration': 259, 'number': 8}, {'title': 'Одним целым', 'artist': 'PHARAOH', 'duration': 166, 'number': 9}, {'title': 'Много дел', 'artist': 'PHARAOH', 'duration': 164, 'number': 10}, {'title': 'Спроси моих друзей', 'artist': 'PHARAOH', 'duration': 166, 'number': 11}, {'title': 'Мелисса / Моя сука', 'artist': 'PHARAOH', 'duration': 185, 'number': 12}, {'title': 'Без меня (feat. Mnogoznaal)', 'artist': 'PHARAOH', 'duration': 243, 'number': 13}, {'title': 'Одинокая звезда', 'artist': 'PHARAOH', 'duration': 195, 'number': 14}, {'title': 'Порнозвезда (feat. NOA) [Remix] [Bonus Track]', 'artist': 'PHARAOH', 'duration': 264, 'number': 15}]}, 'PHARAOH|PHUNERAL': {'artist': 'PHARAOH', 'title': 'PHUNERAL', 'year': '2018', 'state': 'verified', 'source': 'https://music.apple.com/us/album/phuneral/1431700427?uo=4', 'referenceId': 1431700427, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/e3/bb/f9/e3bbf9a0-2b68-ab85-1699-84c18a52ee03/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Дефект', 'artist': 'PHARAOH', 'duration': 153, 'number': 1}, {'title': 'Смарт', 'artist': 'PHARAOH', 'duration': 148, 'number': 2}, {'title': '10:0 фристайл', 'artist': 'PHARAOH', 'duration': 164, 'number': 3}, {'title': 'Флешгроб (feat. рубль)', 'artist': 'PHARAOH', 'duration': 90, 'number': 4}, {'title': 'Откровение успешного человека', 'artist': 'PHARAOH', 'duration': 156, 'number': 5}, {'title': 'Омертвение', 'artist': 'PHARAOH', 'duration': 145, 'number': 6}, {'title': 'Солярис (feat. Сергей Шнуров)', 'artist': 'PHARAOH', 'duration': 183, 'number': 7}, {'title': 'Мой кайф', 'artist': 'PHARAOH', 'duration': 162, 'number': 8}, {'title': 'Последний трек на стене', 'artist': 'PHARAOH', 'duration': 172, 'number': 9}, {'title': 'Шипучка (feat. Big Baby Tape)', 'artist': 'PHARAOH', 'duration': 180, 'number': 10}, {'title': '1996', 'artist': 'PHARAOH', 'duration': 160, 'number': 11}, {'title': 'RAW 2', 'artist': 'PHARAOH', 'duration': 187, 'number': 12}, {'title': 'Пэрис Хилтон хоум видео (feat. noa)', 'artist': 'PHARAOH', 'duration': 175, 'number': 13}, {'title': 'Лантана', 'artist': 'PHARAOH', 'duration': 118, 'number': 14}, {'title': 'Пломбир (Bonus)', 'artist': 'PHARAOH', 'duration': 163, 'number': 15}]}, 'PHARAOH|Правило': {'artist': 'PHARAOH', 'title': 'Правило', 'year': '2020', 'state': 'verified', 'source': 'https://music.apple.com/us/album/%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D0%BE/1503019520?uo=4', 'referenceId': 1503019520, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/62/de/a2/62dea2d3-dadd-7aea-40f5-c0ff5d7fe504/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Ночь пятницы', 'artist': 'PHARAOH', 'duration': 195, 'number': 1}, {'title': 'Без ключа', 'artist': 'PHARAOH', 'duration': 160, 'number': 2}, {'title': 'Не хочу (feat. Mishaal & Dima Roux)', 'artist': 'PHARAOH', 'duration': 188, 'number': 3}, {'title': 'Тост (feat. Молодой Платон)', 'artist': 'PHARAOH', 'duration': 150, 'number': 4}, {'title': 'AMG', 'artist': 'PHARAOH', 'duration': 171, 'number': 5}, {'title': 'То, чего нет', 'artist': 'PHARAOH', 'duration': 205, 'number': 6}, {'title': 'Баллада', 'artist': 'PHARAOH', 'duration': 149, 'number': 7}, {'title': 'За решёткой', 'artist': 'PHARAOH', 'duration': 161, 'number': 8}, {'title': 'Лоулайф', 'artist': 'PHARAOH', 'duration': 162, 'number': 9}, {'title': 'Призрак', 'artist': 'PHARAOH', 'duration': 169, 'number': 10}, {'title': 'Чувствую (feat. Dima Roux)', 'artist': 'PHARAOH', 'duration': 169, 'number': 11}, {'title': 'Семейные узы (feat. Mnogoznaal)', 'artist': 'PHARAOH', 'duration': 134, 'number': 12}, {'title': 'Из-за тебя', 'artist': 'PHARAOH', 'duration': 198, 'number': 13}]}, 'Boulevard Depo|RAPP2': {'artist': 'Boulevard Depo', 'title': 'RAPP2', 'year': '2018', 'state': 'verified', 'source': 'https://music.apple.com/us/album/rapp2/1444643689?uo=4', 'referenceId': 1444643689, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/f8/0e/b9/f80eb9fb-0683-5ac2-5b39-370ef7029cc1/190296893520.jpg/600x600bb.jpg', 'tracks': [{'title': 'Outro', 'artist': 'Boulevard Depo', 'duration': 149, 'number': 1}, {'title': 'AKA (feat. Bizzzae)', 'artist': 'Boulevard Depo', 'duration': 211, 'number': 2}, {'title': 'Кащенко (feat. PowerpuffLuv)', 'artist': 'Boulevard Depo', 'duration': 167, 'number': 3}, {'title': 'White Trash (feat. ЛАУД)', 'artist': 'Boulevard Depo', 'duration': 96, 'number': 4}, {'title': 'Ох уж эти детки', 'artist': 'Boulevard Depo', 'duration': 174, 'number': 5}, {'title': 'Люди дрессируют людей (feat. Big Baby Tape)', 'artist': 'Boulevard Depo', 'duration': 213, 'number': 6}, {'title': 'ANTIANTI (feat. OFFMi)', 'artist': 'Boulevard Depo', 'duration': 177, 'number': 7}, {'title': 'Повышать (feat. Poproboval)', 'artist': 'Boulevard Depo', 'duration': 92, 'number': 8}, {'title': 'Snake in the Snacks (feat. Sapa13)', 'artist': 'Boulevard Depo', 'duration': 141, 'number': 9}, {'title': 'OFMD', 'artist': 'Boulevard Depo', 'duration': 140, 'number': 10}, {'title': 'Hot Wheels (feat. Hot Sugar)', 'artist': 'Boulevard Depo', 'duration': 192, 'number': 11}, {'title': 'NBA', 'artist': 'Boulevard Depo', 'duration': 145, 'number': 12}, {'title': 'Ожоги (feat. IC3PEAK)', 'artist': 'Boulevard Depo', 'duration': 167, 'number': 13}, {'title': 'Oreo (feat. I61 & Summer of Haze)', 'artist': 'Boulevard Depo', 'duration': 260, 'number': 14}]}, 'Boulevard Depo|OLD BLOOD': {'artist': 'Boulevard Depo', 'title': 'OLD BLOOD', 'year': '2020', 'state': 'verified', 'source': 'https://music.apple.com/us/album/old-blood/1512811972?uo=4', 'referenceId': 1512811972, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/4c/51/cb/4c51cb4f-b086-c5e6-0abe-1a882f0b10aa/190295212063.jpg/600x600bb.jpg', 'tracks': [{'title': 'Введение', 'artist': 'Boulevard Depo', 'duration': 34, 'number': 1}, {'title': 'Ни много ни мало', 'artist': 'Boulevard Depo', 'duration': 143, 'number': 2}, {'title': 'MOONWORK (feat. Basic Boy)', 'artist': 'Boulevard Depo', 'duration': 214, 'number': 3}, {'title': 'Angry toy$', 'artist': 'Boulevard Depo', 'duration': 127, 'number': 4}, {'title': 'Возраст (feat. Artur Kreem)', 'artist': 'Boulevard Depo', 'duration': 138, 'number': 5}, {'title': 'OLD BLOOD', 'artist': 'Boulevard Depo', 'duration': 138, 'number': 6}, {'title': 'Умы (feat. DopeVvs)', 'artist': 'Boulevard Depo', 'duration': 125, 'number': 7}, {'title': 'NO HOOK NO HOES (feat. Yung Hurn)', 'artist': 'Boulevard Depo', 'duration': 132, 'number': 8}, {'title': 'ART HOES', 'artist': 'Boulevard Depo', 'duration': 183, 'number': 9}, {'title': 'Friendly Fire', 'artist': 'Boulevard Depo', 'duration': 122, 'number': 10}, {'title': 'X2', 'artist': 'Boulevard Depo', 'duration': 176, 'number': 11}, {'title': '4 шага', 'artist': 'Boulevard Depo', 'duration': 135, 'number': 12}]}, 'ЛСП|Magic City': {'artist': 'ЛСП', 'title': 'Magic City', 'year': '2015', 'state': 'verified', 'source': 'https://music.apple.com/us/album/magic-city/1580599899?uo=4', 'referenceId': 1580599899, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ae/7d/8b/ae7d8ba4-704c-46e3-b639-b9b1affd2f88/4680017661805.jpg/600x600bb.jpg', 'tracks': [{'title': 'Magic City (feat. Степан Карма)', 'artist': 'LSP', 'duration': 85, 'number': 1}, {'title': 'Шест', 'artist': 'LSP', 'duration': 202, 'number': 2}, {'title': 'Bullet (feat. PHARAOH)', 'artist': 'LSP', 'duration': 235, 'number': 3}, {'title': 'Фокус', 'artist': 'LSP', 'duration': 224, 'number': 4}, {'title': 'Уровни', 'artist': 'LSP', 'duration': 236, 'number': 5}, {'title': 'OK', 'artist': 'LSP', 'duration': 186, 'number': 6}, {'title': 'Bankroll (feat. Sil-A)', 'artist': 'LSP', 'duration': 206, 'number': 7}, {'title': 'Безумие', 'artist': 'Oxxxymiron & LSP', 'duration': 226, 'number': 8}, {'title': 'Пусть говорят', 'artist': 'LSP', 'duration': 214, 'number': 9}, {'title': 'Что-то ещё', 'artist': 'LSP', 'duration': 241, 'number': 10}, {'title': 'Бигги', 'artist': 'LSP', 'duration': 178, 'number': 11}, {'title': 'Синее', 'artist': 'LSP', 'duration': 209, 'number': 12}]}, 'ЛСП|Трагик Сити': {'artist': 'ЛСП', 'title': 'Трагик Сити', 'year': '2017', 'state': 'verified', 'source': 'https://music.apple.com/us/album/tragic-city/1580604942?uo=4', 'referenceId': 1580604942, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/b9/b0/d6/b9b0d6f0-cd0f-4fbe-2e07-bc88563d9462/4680017660181.jpg/600x600bb.jpg', 'tracks': [{'title': 'Ползать', 'artist': 'LSP', 'duration': 159, 'number': 1}, {'title': 'Монетка', 'artist': 'LSP', 'duration': 200, 'number': 2}, {'title': 'Деньги не проблема', 'artist': 'LSP', 'duration': 237, 'number': 3}, {'title': 'Тело', 'artist': 'LSP', 'duration': 225, 'number': 4}, {'title': 'Воскресение', 'artist': 'LSP', 'duration': 181, 'number': 5}, {'title': 'Лабиринт отражений', 'artist': 'LSP', 'duration': 178, 'number': 6}, {'title': 'Белый танец', 'artist': 'LSP', 'duration': 275, 'number': 7}, {'title': 'Отброс', 'artist': 'LSP', 'duration': 152, 'number': 8}, {'title': 'Канкан', 'artist': 'LSP', 'duration': 254, 'number': 9}, {'title': 'Еще один день', 'artist': 'LSP', 'duration': 244, 'number': 10}, {'title': 'Интерлюдия (feat. Лёха Никонов)', 'artist': 'LSP', 'duration': 66, 'number': 11}, {'title': 'Конец света', 'artist': 'LSP', 'duration': 348, 'number': 12}, {'title': 'Плевок в вечность', 'artist': 'LSP', 'duration': 194, 'number': 13}]}, 'Big Baby Tape|Dragonborn': {'artist': 'Big Baby Tape', 'title': 'Dragonborn', 'year': '2018', 'state': 'verified', 'source': 'https://music.apple.com/us/album/dragonborn/1442022364?uo=4', 'referenceId': 1442022364, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/25/1e/61/251e61e2-07e5-18ea-c571-8ba767dade30/190296893414.jpg/600x600bb.jpg', 'tracks': [{'title': 'DB Intro', 'artist': 'Big Baby Tape', 'duration': 65, 'number': 1}, {'title': 'Dragonborn', 'artist': 'Big Baby Tape', 'duration': 189, 'number': 2}, {'title': 'ACAB', 'artist': 'Big Baby Tape', 'duration': 131, 'number': 3}, {'title': 'Benzo Gang Money', 'artist': 'Big Baby Tape', 'duration': 160, 'number': 4}, {'title': 'Wasabi', 'artist': 'Big Baby Tape', 'duration': 175, 'number': 5}, {'title': 'Project X', 'artist': 'Big Baby Tape', 'duration': 109, 'number': 6}, {'title': 'Vampire Type Bitch (feat. Dope V)', 'artist': 'Big Baby Tape', 'duration': 190, 'number': 7}, {'title': 'Blast!', 'artist': 'Big Baby Tape', 'duration': 117, 'number': 8}, {'title': 'Boyz from the Hood (feat. I61)', 'artist': 'Big Baby Tape', 'duration': 184, 'number': 9}, {'title': 'Hokage', 'artist': 'Big Baby Tape', 'duration': 174, 'number': 10}, {'title': '1000 Shells (feat. Loco OG Rocka)', 'artist': 'Big Baby Tape', 'duration': 190, 'number': 11}, {'title': 'Cream Soda', 'artist': 'Big Baby Tape', 'duration': 197, 'number': 12}, {'title': '98 Flow (feat. Хаски)', 'artist': 'Big Baby Tape', 'duration': 237, 'number': 13}, {'title': 'Hot Wigga', 'artist': 'Big Baby Tape', 'duration': 130, 'number': 14}, {'title': 'Flip Phone Twerk', 'artist': 'Big Baby Tape', 'duration': 141, 'number': 15}, {'title': 'MILF', 'artist': 'Big Baby Tape', 'duration': 167, 'number': 16}, {'title': 'Konichiwa (feat. Boulevard Depo)', 'artist': 'Big Baby Tape', 'duration': 178, 'number': 17}, {'title': 'Gucci Kandelaki 2016', 'artist': 'Big Baby Tape', 'duration': 134, 'number': 18}, {'title': 'Hadouken! (feat. OG Prince)', 'artist': 'Big Baby Tape', 'duration': 220, 'number': 19}, {'title': 'Gimme the Loot', 'artist': 'Big Baby Tape', 'duration': 141, 'number': 20}, {'title': 'Coldfront (feat. White Punk)', 'artist': 'Big Baby Tape', 'duration': 130, 'number': 21}, {'title': 'Hard 2 Kill (feat. JEEMBO)', 'artist': 'Big Baby Tape', 'duration': 180, 'number': 22}, {'title': 'DB Outro', 'artist': 'Big Baby Tape', 'duration': 97, 'number': 23}]}, 'Big Baby Tape|VARSKVA': {'artist': 'Big Baby Tape', 'title': 'VARSKVA', 'year': '2023', 'state': 'verified', 'source': 'https://music.apple.com/us/album/varskva/1717089122?uo=4', 'referenceId': 1717089122, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/29/9d/35/299d35de-3ab5-218b-a7cd-05fd53cc5007/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Dying 2 Live', 'artist': 'Big Baby Tape', 'duration': 162, 'number': 1}, {'title': 'Lo Siento', 'artist': 'Big Baby Tape', 'duration': 158, 'number': 2}, {'title': 'Keys to the City', 'artist': 'Big Baby Tape', 'duration': 165, 'number': 3}, {'title': 'Twerkaa', 'artist': 'Big Baby Tape', 'duration': 174, 'number': 4}, {'title': '4X4', 'artist': 'Big Baby Tape', 'duration': 194, 'number': 5}, {'title': 'Benzomageddon', 'artist': 'Big Baby Tape', 'duration': 162, 'number': 6}, {'title': 'Wake and Bake', 'artist': 'Big Baby Tape', 'duration': 144, 'number': 7}, {'title': 'Bentayga', 'artist': 'Big Baby Tape', 'duration': 136, 'number': 8}, {'title': 'Passengers & Pilots', 'artist': 'Big Baby Tape', 'duration': 132, 'number': 9}, {'title': '4 Da Game (feat. MACAN)', 'artist': 'Big Baby Tape', 'duration': 178, 'number': 10}, {'title': 'Last Summer', 'artist': 'Big Baby Tape', 'duration': 160, 'number': 11}, {'title': 'Dirty Bidness (feat. kizaru)', 'artist': 'Big Baby Tape', 'duration': 119, 'number': 12}, {'title': 'On Gang (feat. Baby Melo)', 'artist': 'Big Baby Tape', 'duration': 186, 'number': 13}, {'title': 'RIP Trappa', 'artist': 'Big Baby Tape', 'duration': 153, 'number': 14}, {'title': "Mama Don't Cry (feat. Huzzy Buzzy)", 'artist': 'Big Baby Tape', 'duration': 218, 'number': 15}, {'title': 'Baller', 'artist': 'Big Baby Tape', 'duration': 181, 'number': 16}, {'title': 'M11 (feat. ALBLAK 52)', 'artist': 'Big Baby Tape', 'duration': 157, 'number': 17}, {'title': 'Dayang', 'artist': 'Big Baby Tape', 'duration': 167, 'number': 18}, {'title': 'Lyfe', 'artist': 'Big Baby Tape', 'duration': 163, 'number': 19}]}, 'KIZARU|Karmageddon': {'artist': 'KIZARU', 'title': 'Karmageddon', 'year': '2019', 'state': 'verified', 'source': 'https://music.apple.com/us/album/karmageddon/1650807622?uo=4', 'referenceId': 1650807622, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/87/58/e8/8758e8a3-3057-6f2c-00c2-d2e2730441a9/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Дежавю', 'artist': 'kizaru', 'duration': 174, 'number': 1}, {'title': 'Top Dog', 'artist': 'kizaru', 'duration': 140, 'number': 2}, {'title': 'Водопад', 'artist': 'kizaru', 'duration': 175, 'number': 3}, {'title': 'Держу район', 'artist': 'kizaru', 'duration': 225, 'number': 4}, {'title': 'Все что угодно', 'artist': 'kizaru', 'duration': 143, 'number': 5}, {'title': 'Money long', 'artist': 'kizaru', 'duration': 135, 'number': 6}, {'title': 'Deep End', 'artist': 'kizaru', 'duration': 273, 'number': 7}, {'title': 'Сим салабим', 'artist': 'kizaru', 'duration': 208, 'number': 8}, {'title': 'Smooth operator', 'artist': 'kizaru', 'duration': 138, 'number': 9}, {'title': 'Психопат-лунатик', 'artist': 'kizaru', 'duration': 177, 'number': 10}, {'title': 'Я сделал это', 'artist': 'kizaru', 'duration': 181, 'number': 11}, {'title': 'Еще одна ночь', 'artist': 'kizaru', 'duration': 174, 'number': 12}, {'title': 'Cinderella', 'artist': 'kizaru', 'duration': 218, 'number': 13}, {'title': 'На мне детка', 'artist': 'kizaru', 'duration': 193, 'number': 14}, {'title': 'Исповедь', 'artist': 'kizaru', 'duration': 196, 'number': 15}]}, 'KIZARU|Born To Trap': {'artist': 'KIZARU', 'title': 'Born To Trap', 'year': '2020', 'state': 'verified', 'source': 'https://music.apple.com/us/album/born-to-trap/1650846344?uo=4', 'referenceId': 1650846344, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/dd/8c/c4/dd8cc41d-c754-c957-4046-e696b8e27638/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Intro', 'artist': 'kizaru', 'duration': 113, 'number': 1}, {'title': 'Что за бизнес сука?', 'artist': 'kizaru', 'duration': 205, 'number': 2}, {'title': 'Block Baby', 'artist': 'kizaru', 'duration': 209, 'number': 3}, {'title': 'G Shit', 'artist': 'kizaru', 'duration': 201, 'number': 4}, {'title': 'Plug', 'artist': 'kizaru', 'duration': 206, 'number': 5}, {'title': 'Изи арифметика', 'artist': 'kizaru', 'duration': 151, 'number': 6}, {'title': 'Bad Blood (feat. Tory Lanez)', 'artist': 'kizaru', 'duration': 191, 'number': 7}, {'title': 'Газ в пол', 'artist': 'kizaru', 'duration': 143, 'number': 8}, {'title': 'Ice Cream', 'artist': 'kizaru', 'duration': 178, 'number': 9}, {'title': 'Whistle Song', 'artist': 'kizaru', 'duration': 145, 'number': 10}, {'title': 'Trapazoid', 'artist': 'kizaru', 'duration': 174, 'number': 11}, {'title': 'You and me (feat. Smokepurpp)', 'artist': 'kizaru', 'duration': 181, 'number': 12}, {'title': 'Oh Whou', 'artist': 'kizaru', 'duration': 175, 'number': 13}, {'title': 'Wassup homie', 'artist': 'kizaru', 'duration': 231, 'number': 14}, {'title': "Honey's Kettle (feat. HoodRich Pablo Juan)", 'artist': 'kizaru', 'duration': 168, 'number': 15}, {'title': 'Mr. Slime', 'artist': 'kizaru', 'duration': 173, 'number': 16}, {'title': 'Keep Straight', 'artist': 'kizaru', 'duration': 175, 'number': 17}, {'title': 'Narcos', 'artist': 'kizaru', 'duration': 170, 'number': 18}]}, 'OG Buda|ОПГ СИТИ': {'artist': 'OG Buda', 'title': 'ОПГ СИТИ', 'year': '2019', 'state': 'verified', 'source': 'https://music.apple.com/us/album/%D0%BE%D0%BF%D0%B3-%D1%81%D0%B8%D1%82%D0%B8/1841382340?uo=4', 'referenceId': 1841382340, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/3c/c9/233cc9a7-1785-e6e4-c151-3271e1b571df/cover.png/600x600bb.jpg', 'tracks': [{'title': 'Вверх вниз', 'artist': 'OG BUDA', 'duration': 214, 'number': 1}, {'title': 'Джефф Харди', 'artist': 'OG BUDA', 'duration': 153, 'number': 2}, {'title': 'Бандит', 'artist': 'OG BUDA', 'duration': 192, 'number': 3}, {'title': 'Всё равно (feat. MAYOT)', 'artist': 'OG BUDA', 'duration': 204, 'number': 4}, {'title': 'Подсадил (feat. noa)', 'artist': 'OG BUDA', 'duration': 160, 'number': 5}, {'title': 'Больно', 'artist': 'OG BUDA', 'duration': 162, 'number': 6}, {'title': 'Кумир (feat. Polyana)', 'artist': 'OG BUDA', 'duration': 262, 'number': 7}, {'title': 'На трапе', 'artist': 'OG BUDA', 'duration': 250, 'number': 8}, {'title': 'Выше облаков (feat. FEDUK, Платина & OBLADAET)', 'artist': 'OG BUDA', 'duration': 278, 'number': 9}, {'title': 'ОПГ сити', 'artist': 'OG BUDA', 'duration': 217, 'number': 10}, {'title': 'Кровосток', 'artist': 'OG BUDA', 'duration': 140, 'number': 11}, {'title': 'МОБ (feat. LIL MORTY)', 'artist': 'OG BUDA', 'duration': 246, 'number': 12}, {'title': 'Лил мами (feat. LIL KRYSTALLL)', 'artist': 'OG BUDA', 'duration': 138, 'number': 13}, {'title': 'Зомби (feat. White Punk)', 'artist': 'OG BUDA', 'duration': 164, 'number': 14}, {'title': 'Откровения (feat. FEDUK)', 'artist': 'OG BUDA', 'duration': 215, 'number': 15}, {'title': 'Печеньки', 'artist': 'OG BUDA', 'duration': 152, 'number': 16}, {'title': 'Начало', 'artist': 'OG BUDA', 'duration': 126, 'number': 17}, {'title': 'Стрипуха', 'artist': 'OG BUDA', 'duration': 168, 'number': 18}, {'title': 'Секси (feat. Yanix)', 'artist': 'OG BUDA', 'duration': 161, 'number': 19}, {'title': 'Биг бой слайм', 'artist': 'OG BUDA', 'duration': 128, 'number': 20}, {'title': 'Легенды Зельды (feat. Big Baby Tape)', 'artist': 'OG BUDA', 'duration': 238, 'number': 21}, {'title': 'Нет, брат', 'artist': 'OG BUDA', 'duration': 126, 'number': 22}, {'title': 'Хот бокс', 'artist': 'OG BUDA', 'duration': 152, 'number': 23}]}, 'FRIENDLY THUG 52 NGG|Cristoforo Colombo': {'artist': 'FRIENDLY THUG 52 NGG', 'title': 'Cristoforo Colombo', 'year': '2023', 'state': 'verified', 'source': 'https://music.apple.com/us/album/cristoforo-colombo/1714308349?uo=4', 'referenceId': 1714308349, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/73/99/85/739985c1-64a8-b6a9-5ea7-051949f90d45/cover.jpg/600x600bb.jpg', 'tracks': [{'title': 'Intro', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 86, 'number': 1}, {'title': 'No Gletcher Gang', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 138, 'number': 2}, {'title': 'No Rats This Time', 'artist': 'FRIENDLY THUG 52 NGG & Yanix', 'duration': 160, 'number': 3}, {'title': 'Legit Check', 'artist': 'FRIENDLY THUG 52 NGG & Big Baby Tape', 'duration': 157, 'number': 4}, {'title': 'Corner Close Day', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 154, 'number': 5}, {'title': 'All My Members Are CEO', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 98, 'number': 6}, {'title': 'na Circus', 'artist': 'FRIENDLY THUG 52 NGG & Skryptonite', 'duration': 190, 'number': 7}, {'title': 'Lost Angeles', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 114, 'number': 8}, {'title': 'Back To Back', 'artist': 'FRIENDLY THUG 52 NGG & Hugo Loud', 'duration': 171, 'number': 9}, {'title': 'Sold Out', 'artist': 'FRIENDLY THUG 52 NGG & kizaru', 'duration': 153, 'number': 10}, {'title': 'Sladki Snov Rapper 2', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 134, 'number': 11}, {'title': 'October', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 107, 'number': 12}, {'title': 'After Paper Flow', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 128, 'number': 13}, {'title': 'Cristoforo Colombo', 'artist': 'FRIENDLY THUG 52 NGG', 'duration': 95, 'number': 14}]}, 'Kai Angel & 9mice|HEAVY METAL': {'artist': 'Kai Angel & 9mice', 'title': 'HEAVY METAL', 'year': '2023', 'state': 'verified', 'source': 'https://music.apple.com/us/album/heavy-metal-ep/1889978892?uo=4', 'referenceId': 1889978892, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d2/b3/e4/d2b3e4e6-fc71-2275-5cd2-ddefbc1fab4e/0.jpg/600x600bb.jpg', 'tracks': [{'title': 'LIPSTICK', 'artist': 'Kai Angel & 9mice', 'duration': 122, 'number': 1}, {'title': 'N1CHEVO', 'artist': 'Kai Angel & 9mice', 'duration': 105, 'number': 2}, {'title': 'RESIDENT EVI7', 'artist': 'Kai Angel & 9mice', 'duration': 152, 'number': 3}, {'title': 'AQUAFINA', 'artist': 'Kai Angel & 9mice', 'duration': 170, 'number': 4}, {'title': 'HEAVY METAL', 'artist': 'Kai Angel & 9mice', 'duration': 139, 'number': 5}, {'title': 'OD1NOKO FREESTYLE', 'artist': 'Kai Angel & 9mice', 'duration': 138, 'number': 6}]}, 'MORGENSHTERN|Легендарная пыль': {'artist': 'MORGENSHTERN', 'title': 'Легендарная пыль', 'year': '2020', 'state': 'verified', 'source': 'https://music.apple.com/us/album/%D0%BB%D0%B5%D0%B3%D0%B5%D0%BD%D0%B4%D0%B0%D1%80%D0%BD%D0%B0%D1%8F-%D0%BF%D1%8B%D0%BB%D1%8C/1570266761?uo=4', 'referenceId': 1570266761, 'coverImg': 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/24/b7/8c/24b78c80-1982-0569-1c82-c4da9f2ef8b1/3616403389719.jpg/600x600bb.jpg', 'tracks': [{'title': 'Я ПЫЛЬ', 'artist': 'MORGENSHTERN', 'duration': 108, 'number': 1}, {'title': 'СЪЕЛ ДЕДА', 'artist': 'MORGENSHTERN & SLAVA MARLOW', 'duration': 109, 'number': 2}, {'title': 'ЧЕТЫРЕ УКРАИНКИ', 'artist': 'MORGENSHTERN', 'duration': 123, 'number': 3}, {'title': 'Е! БАННАЯ', 'artist': 'MORGENSHTERN', 'duration': 135, 'number': 4}, {'title': 'ОНА - ОНО', 'artist': 'MORGENSHTERN', 'duration': 98, 'number': 5}, {'title': 'КРАСНОЕ ВИНО ФРИСТАЙЛ', 'artist': 'MORGENSHTERN & Frame Tamer', 'duration': 172, 'number': 6}, {'title': 'ДОМОФОН / ЧИЧА', 'artist': 'MORGENSHTERN', 'duration': 92, 'number': 7}, {'title': 'РАТАТАТАТА', 'artist': 'MORGENSHTERN & Vitya AK', 'duration': 118, 'number': 8}, {'title': 'ОПА', 'artist': 'MORGENSHTERN', 'duration': 119, 'number': 9}, {'title': 'последняя', 'artist': 'MORGENSHTERN', 'duration': 181, 'number': 10}]}}

REFERENCES.update({'Whole Lotta Swag|First Day In Therapy': {'artist': 'Whole Lotta Swag', 'title': 'First Day In Therapy', 'year': '2026', 'source': 'https://music.apple.com/us/album/first-day-in-therapy/1891504524?uo=4', 'tracks': [{'title': 'Интро', 'artist': 'Whole Lotta Swag', 'duration': 50, 'number': 1}, {'title': 'Первый день в терапии', 'artist': 'Whole Lotta Swag', 'duration': 138, 'number': 2}, {'title': 'Хороший знак', 'artist': 'Whole Lotta Swag', 'duration': 144, 'number': 3}, {'title': 'Обнял, поцеловал', 'artist': 'Whole Lotta Swag', 'duration': 158, 'number': 4}, {'title': 'ЗМ', 'artist': 'Whole Lotta Swag', 'duration': 128, 'number': 5}, {'title': 'Дорогая митка', 'artist': 'Whole Lotta Swag', 'duration': 163, 'number': 6}, {'title': 'Каталог (feat. VERi RERi)', 'artist': 'Whole Lotta Swag', 'duration': 164, 'number': 7}, {'title': 'Все из-за татух', 'artist': 'Whole Lotta Swag', 'duration': 143, 'number': 8}, {'title': 'BIG BR', 'artist': 'Whole Lotta Swag', 'duration': 153, 'number': 9}, {'title': 'Хэмильтон (feat. GATASKI)', 'artist': 'Whole Lotta Swag', 'duration': 176, 'number': 10}, {'title': 'GOAT', 'artist': 'Whole Lotta Swag', 'duration': 127, 'number': 11}, {'title': 'Перед домом (feat. САЙКО)', 'artist': 'Whole Lotta Swag', 'duration': 186, 'number': 12}, {'title': 'Важные слова', 'artist': 'Whole Lotta Swag', 'duration': 169, 'number': 13}, {'title': 'Папа', 'artist': 'Whole Lotta Swag', 'duration': 181, 'number': 14}, {'title': 'Я рад (bonus track)', 'artist': 'Whole Lotta Swag', 'duration': 137, 'number': 15}]}, 'Kai Angel|damage': {'artist': 'Kai Angel', 'title': 'damage', 'year': '2025', 'source': 'https://music.apple.com/us/album/damage/1836427637?uo=4', 'tracks': [{'title': 'are you happy', 'artist': 'Kai Angel', 'duration': 192, 'number': 1}, {'title': 'im all blessed the f**k up', 'artist': 'Kai Angel', 'duration': 215, 'number': 2}, {'title': 'basement', 'artist': 'Kai Angel', 'duration': 135, 'number': 3}, {'title': 'body double', 'artist': 'Kai Angel', 'duration': 112, 'number': 4}, {'title': 'mirrors', 'artist': 'Kai Angel', 'duration': 132, 'number': 5}, {'title': 'chelsea smile', 'artist': 'Kai Angel', 'duration': 136, 'number': 6}, {'title': '444', 'artist': 'Kai Angel', 'duration': 136, 'number': 7}, {'title': 'parasocial freestyle', 'artist': 'Kai Angel', 'duration': 110, 'number': 8}, {'title': "designer's paradise", 'artist': 'Kai Angel', 'duration': 122, 'number': 9}, {'title': 'fire walk with me', 'artist': 'Kai Angel', 'duration': 68, 'number': 10}, {'title': 'Madam', 'artist': 'Kai Angel', 'duration': 142, 'number': 11}, {'title': 'sirens', 'artist': 'Kai Angel', 'duration': 122, 'number': 12}, {'title': 'naive', 'artist': 'Kai Angel', 'duration': 97, 'number': 13}, {'title': 'drive', 'artist': 'Kai Angel', 'duration': 115, 'number': 14}, {'title': 'welcome to forever', 'artist': 'Kai Angel', 'duration': 166, 'number': 15}, {'title': '0 tears', 'artist': 'Kai Angel', 'duration': 145, 'number': 16}, {'title': 'damage', 'artist': 'Kai Angel', 'duration': 180, 'number': 17}]}, 'Kai Angel|Shh...': {'artist': 'Kai Angel', 'title': 'Shh...', 'year': '2026', 'source': 'https://music.apple.com/us/album/shh/6808162752?uo=4', 'tracks': [{'title': 'TV', 'artist': 'Kai Angel', 'duration': 189, 'number': 1}, {'title': 'Mulholland', 'artist': 'Kai Angel', 'duration': 158, 'number': 2}, {'title': 'evil icon baby', 'artist': 'Kai Angel', 'duration': 141, 'number': 3}, {'title': 'pleasure', 'artist': 'Kai Angel', 'duration': 197, 'number': 4}, {'title': 'NAKED', 'artist': 'Kai Angel', 'duration': 208, 'number': 5}, {'title': 'Razorblade kiss', 'artist': 'Kai Angel', 'duration': 189, 'number': 6}, {'title': 'Pretty Girls', 'artist': 'Kai Angel', 'duration': 178, 'number': 7}, {'title': 'andy warhol', 'artist': 'Kai Angel', 'duration': 177, 'number': 8}, {'title': '1 more', 'artist': 'Kai Angel', 'duration': 122, 'number': 9}, {'title': 'BABYLON', 'artist': 'Kai Angel', 'duration': 147, 'number': 10}, {'title': 'le royal monceau gatsby séance', 'artist': 'Kai Angel', 'duration': 142, 'number': 11}, {'title': 'Limousine Music', 'artist': 'Kai Angel', 'duration': 188, 'number': 12}, {'title': 'yes i glow in the dark but also i am the dark', 'artist': 'Kai Angel', 'duration': 182, 'number': 13}, {'title': 'Flowers', 'artist': 'Kai Angel', 'duration': 204, 'number': 14}]}, 'Kai Angel|Shh!': {'artist': 'Kai Angel', 'title': 'Shh!', 'year': '2026', 'source': 'https://music.apple.com/us/album/shh/6810597974?uo=4', 'tracks': [{'title': 'Shh!', 'artist': 'Kai Angel', 'duration': 126, 'number': 1}, {'title': 'chateau', 'artist': 'Kai Angel', 'duration': 117, 'number': 2}, {'title': 'gladiator', 'artist': 'Kai Angel', 'duration': 104, 'number': 3}, {'title': 'OFFICE SONG', 'artist': 'Kai Angel', 'duration': 103, 'number': 4}, {'title': 'david bowie', 'artist': 'Kai Angel', 'duration': 93, 'number': 5}, {'title': 'having fun', 'artist': 'Kai Angel', 'duration': 135, 'number': 6}, {'title': 'Leopard Red', 'artist': 'Kai Angel', 'duration': 115, 'number': 7}, {'title': 'Sting', 'artist': 'Kai Angel', 'duration': 132, 'number': 8}, {'title': 'ew', 'artist': 'Kai Angel', 'duration': 106, 'number': 9}, {'title': 'STFU!', 'artist': 'Kai Angel', 'duration': 175, 'number': 10}, {'title': '1971 Rockstar', 'artist': 'Kai Angel', 'duration': 104, 'number': 11}, {'title': 'does it hurt?', 'artist': 'Kai Angel', 'duration': 103, 'number': 12}, {'title': 'Madam 2', 'artist': 'Kai Angel', 'duration': 110, 'number': 13}, {'title': 'chrome hearts', 'artist': 'Kai Angel', 'duration': 136, 'number': 14}]}})


def official_title_search(sc,artist,query,offset=0):
 q=key(query).replace('фририо','freerio').replace('opgcity','опгсити')
 if any(q in key(p['title'])for p in OG_PINS):
  matches=prefer_og_pins(sc,[],query=q)
  return {'albums':matches[offset:offset+20],'tracks':[],'hasMore':offset+20<len(matches),'nextOffset':offset+20}
 def collect():
  albums=[];cursor=0
  for _ in range(10):
   page=profile_releases(sc,artist,cursor);albums.extend(page['albums'])
   if not page['hasMore']:break
   cursor=page['nextOffset']
  return dedupe(albums)
 albums=cached(('official_release_index_v2',key(artist)),collect)
 q=key(query).replace('фририо','freerio').replace('opgcity','опгсити')
 matches=[a for a in albums if q in key(a['title'])]
 matches=prefer_og_pins(sc,matches,query=q)
 if offset==0:matches=dedupe(matches+[a for a in editorial_search(sc,query)if release_key(a)not in{release_key(b)for b in matches}])
 return {'albums':matches[offset:offset+20],'tracks':[],'hasMore':offset+20<len(matches),'nextOffset':offset+20}


def prefer_og_pins(sc,albums,all_pins=False,query=''):
 selected=[p for p in OG_PINS if all_pins or query and query in key(p['title'])or any(release_key(a)==release_key(p)for a in albums)]
 pinned=[approved_card(sc,p)for p in selected]
 keys={release_key(p)for p in selected}
 return pinned+[a for a in albums if release_key(a)not in keys]


def approved_card(sc,pin):
 # Listing a selected release must not depend on resolving every other release.
 with LOCK:entry=CACHE.get(pin['url'])
 if entry and entry[0]>time.time():return normal(sc,entry[1],pin)
 return {'id':pin.get('urn')or pin['url'],'url':pin['url'],'artist':pin['artist'],'title':pin['title'],'year':pin['year'],'trackCount':0,'coverImg':pin.get('coverImg','')}


def source_track_urn(track):
 value=str(track.get('urn')or track.get('id')or'')
 if value.isdigit():value='soundcloud:tracks:'+value
 return value if re.fullmatch(r'soundcloud:tracks:\d+',value)else''

ALBUM_SOURCE_DIAGNOSTICS={}

def source_diagnostics():
 with LOCK:return {k:dict(v,attempts=list(v['attempts']))for k,v in ALBUM_SOURCE_DIAGNOSTICS.items()}

def load_approved_release(sc,pin):
 urn=pin['urn'];number=urn.rsplit(':',1)[1];paths=list(dict.fromkeys(['/playlists/'+urn,'/playlists/'+number,'/playlists/'+quote(urn,safe='')]))
 attempts=[]
 def request(path,params):
  try:
   value=sc.api(path,params);attempts.append({'path':path,'status':200});return value
  except sc.APIError as error:
   attempts.append({'path':path,'status':error.status,'code':error.code});raise
  finally:
   with LOCK:ALBUM_SOURCE_DIAGNOSTICS[pin['title']]={'urn':urn,'observed_at':int(time.time()),'attempts':list(attempts)}
 raw=None
 # These are equivalent identifiers of the exact pinned resource, never a search.
 for path in paths:
  try:raw=request(path,{'show_tracks':'true'});break
  except sc.APIError as error:
   if error.status!=404:raise
 if raw is None:
  try:raw=request('/resolve',{'url':pin['url']})
  except sc.APIError as error:
   if error.status!=404:raise
 # Some APIs expose the source's tracks while omitting its playlist metadata.
 if raw is None:raw={'urn':urn,'title':pin['title'],'tracks':[]}
 if not isinstance(raw,dict):raise sc.APIError(502,'album_invalid_metadata_response')
 raw=dict(raw)
 actual=str(raw.get('urn')or raw.get('id')or urn)
 if actual.isdigit():actual='soundcloud:playlists:'+actual
 if actual!=urn:raise sc.APIError(502,'album_identity_mismatch')
 raw.update(urn=urn,permalink_url=pin['url'],artwork_url=raw.get('artwork_url')or pin['coverImg'])
 tracks=raw.get('tracks')or[];expected=int(raw.get('track_count')or len(tracks))
 if not tracks or len(tracks)<expected:
  page=None;route=None
  for candidate in paths:
   try:page=request(candidate+'/tracks',{'linked_partitioning':'true'});route=candidate+'/tracks';break
   except sc.APIError as error:
    if error.status!=404:raise
  if page is None:raise sc.APIError(404,'album_unavailable_in_public_api')
  pages=[];seen=set()
  for _ in range(10):
   pages.extend(page.get('collection',[])if isinstance(page,dict)else page)
   link=page.get('next_href')if isinstance(page,dict)else None
   if not link:break
   parsed=urlsplit(link)
   if parsed.scheme!='https'or parsed.netloc!='api.soundcloud.com'or parsed.path not in(route,route.replace('%3A',':'),route.replace(':','%3A'))or link in seen:raise sc.APIError(502,'album_invalid_cursor')
   seen.add(link);params={k:v[0]for k,v in parse_qs(parsed.query).items()if k in('cursor','offset','limit','linked_partitioning')}
   page=request(route,params)
  else:raise sc.APIError(502,'album_pagination_incomplete')
  tracks=pages
 if len(tracks)<expected:raise sc.APIError(502,'album_tracks_incomplete')
 missing=[source_track_urn(t)for t in tracks if not t.get('title')or 'access'not in t or 'streamable'not in t]
 missing=list(dict.fromkeys(missing))
 if ''in missing:raise sc.APIError(502,'album_invalid_track_identity')
 full={}
 for start in range(0,len(missing),50):
  urns=missing[start:start+50]
  data=request('/tracks',{'urns':','.join(urns),'limit':50})
  for t in(data.get('collection',[])if isinstance(data,dict)else data):full[source_track_urn(t)]=t
 tracks=[full.get(source_track_urn(t),t)for t in tracks]
 if any(not t.get('title')or 'access'not in t or 'streamable'not in t for t in tracks):raise sc.APIError(502,'album_track_metadata_incomplete')
 raw['tracks']=tracks
 return raw

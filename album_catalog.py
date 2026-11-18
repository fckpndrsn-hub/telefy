"""SoundCloud albums/EPs, with two explicitly selected editorial releases."""
import re,time,threading,json
from pathlib import Path
from urllib.parse import quote
LOCK=threading.RLock();CACHE={};BROWSE_LOCK=threading.Lock();BROWSE={}
PINS=[{'url':'https://soundcloud.com/members-only-forever/sets/12-ep','title':'12+ (EP)','artist':'i61 & stereoRYZE','year':'2017','keys':'i61 stereoRYZE 12+ 12 ep голыедети мне очень весело мононоке санандреас'}, {'url':'https://soundcloud.com/pharaohdd/sets/red-um-dullboy-ep','title':'REDЯUM (DULLBOY EP)','artist':'PHARAOH','year':'2019','keys':'pharaoh фара redяum redrum redum dullboy никакой любви фул клип enfants rich убийца узы моба'}]
STARTER=[('PHARAOH','Фосфор','2016'),('PHARAOH','Pink Phloyd','2017'),('PHARAOH','PHUNERAL','2018'),('PHARAOH','Правило','2020'),('Boulevard Depo','RAPP2','2018'),('Boulevard Depo','OLD BLOOD','2020'),('ЛСП','Magic City','2015'),('ЛСП','Трагик Сити','2017'),('Big Baby Tape','Dragonborn','2018'),('Big Baby Tape','VARSKVA','2023'),('KIZARU','Karmageddon','2019'),('KIZARU','Born To Trap','2020'),('OG Buda','ОПГ СИТИ','2019'),('FRIENDLY THUG 52 NGG','Cristoforo Colombo','2023'),('Kai Angel & 9mice','HEAVY METAL','2023'),('MORGENSHTERN','Легендарная пыль','2020')]
ARTIST_PROFILES={'pharaoh':'https://soundcloud.com/deaddynastyph'}
AUTHOR_RELEASES={'pinkphloyd':'https://soundcloud.com/deaddynastyph/sets/pink-phloyd','phuneral':'https://soundcloud.com/deaddynastyph/sets/phuneral','правило':'https://soundcloud.com/deaddynastyph/sets/pravilo','milliondollardepression':'https://soundcloud.com/deaddynastyph/sets/million-dollar-depression'}
def key(value):return re.sub(r'[^\w]','',str(value).casefold().replace('ё','е'))
def clean_title(title,artist):
 title=str(title).strip();title=re.sub(r'^'+re.escape(artist)+r'\s*[-–—:]\s*','',title,flags=re.I)
 title=re.sub(r'\s*[\[(](?:album|альбом|full album|official|\d{1,2}[./-]\d{1,2}[./-]\d{4})[^\])]*[\])]','',title,flags=re.I)
 title=re.sub(r'\s*[\[(](?:(?:19|20)\d{2}|explicit|clean)[\])]','',title,flags=re.I)
 return re.sub(r'\s+',' ',title).strip()
def release_key(album):return key(album['artist'])+':'+key(clean_title(album['title'],album['artist']))
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
 artist=(pin or{}).get('artist')or str((raw.get('publisher_metadata')or{}).get('artist')or user.get('username')or'');title=(pin or{}).get('title')or str(raw.get('title')or'')
 known_title=next((s for s in STARTER if key(clean_title(title,s[0]))==key(s[1])),None)
 if not pin and known_title:artist=known_title[0]
 for candidate in roster(sc):
  if re.match(r'^'+re.escape(candidate)+r'\s*[-–—:]\s*',title,re.I):artist=candidate;break
 title=clean_title(title,artist);known=next((s for s in STARTER if key(s[0])==key(artist)and key(s[1])==key(title)),None)
 return {'id':urn,'title':title,'artist':artist,'year':(pin or{}).get('year')or(known[2]if known else str(raw.get('release_year')or str(raw.get('release_date')or'')[:4])),'coverImg':sc.safe_url(raw.get('artwork_url')).replace('-large.','-t500x500.')or sc.safe_url((raw.get('tracks')or[{}])[0].get('artwork_url')),'url':sc.safe_url(raw.get('permalink_url'))or(pin or{}).get('url',''),'trackCount':int(raw.get('track_count')or len(raw.get('tracks')or[]))}
def resolve_pin(sc,pin):return cached(pin['url'],lambda:sc.api('/resolve',{'url':pin['url']}))
def detail(sc,identity):
 pin=next((p for p in PINS if p['url']==identity),None)
 if pin:raw=resolve_pin(sc,pin)
 else:
  if not re.fullmatch(r'soundcloud:playlists:\d+',identity):raise sc.APIError(400,'invalid_album')
  raw=cached(identity,lambda:sc.api('/playlists/'+quote(identity,safe=''),{'show_tracks':'true'}))
  pin=next((p for p in PINS if p['url']==raw.get('permalink_url')),None)
 album=normal(sc,raw,pin);items=raw.get('tracks')or[]
 if not items and raw.get('track_count',0)>0:
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
 album['trackCount']=len(tracks)
 if not tracks:raise sc.APIError(404,'album_no_playable_tracks')
 return {'album':album,'tracks':tracks,'hasMore':False}

def starter(sc,page):
 albums=[];start=page*2
 for artist,title,year in STARTER[start:start+2]:
  authoritative=AUTHOR_RELEASES.get(key(title))if key(artist)=='pharaoh'else None
  if authoritative:
   try:
    raw=cached(authoritative,lambda:sc.api('/resolve',{'url':authoritative}));identity=normal(sc,raw)['id'];data=cached(('validated_album',identity),lambda:detail(sc,identity));album=dict(data['album']);album.update(title=title,artist=artist,year=year);albums.append(album)
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
   try:data=cached(('validated_album',a['id']),lambda:detail(sc,a['id']))
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
 if key(api_query)in ARTIST_PROFILES:return profile_releases(sc,api_query,offset)
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

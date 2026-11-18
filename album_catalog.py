"""SoundCloud albums/EPs, with two explicitly selected editorial releases."""
import re,time,threading
from urllib.parse import quote
LOCK=threading.RLock();CACHE={}
PINS=[{'url':'https://soundcloud.com/members-only-forever/sets/12-ep','title':'12+ (EP)','artist':'i61 & stereoRYZE','year':'2017','keys':'i61 stereoRYZE 12+ 12 ep голыедети мне очень весело мононоке санандреас'}, {'url':'https://soundcloud.com/pharaohdd/sets/red-um-dullboy-ep','title':'REDЯUM (DULLBOY EP)','artist':'PHARAOH','year':'2019','keys':'pharaoh фара redяum redrum redum dullboy никакой любви фул клип enfants rich убийца узы моба'}]
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
 return {'id':urn,'title':(pin or{}).get('title')or str(raw.get('title')or''),'artist':(pin or{}).get('artist')or str((raw.get('publisher_metadata')or{}).get('artist')or user.get('username')or''),'year':(pin or{}).get('year')or str(raw.get('release_year')or str(raw.get('release_date')or'')[:4]),'coverImg':sc.safe_url(raw.get('artwork_url')).replace('-large.','-t500x500.')or sc.safe_url((raw.get('tracks')or[{}])[0].get('artwork_url')),'url':sc.safe_url(raw.get('permalink_url'))or(pin or{}).get('url',''),'trackCount':int(raw.get('track_count')or len(raw.get('tracks')or[]))}
def resolve_pin(sc,pin):return cached(pin['url'],lambda:sc.api('/resolve',{'url':pin['url']}))
def detail(sc,identity):
 pin=next((p for p in PINS if p['url']==identity),None)
 if pin:raw=resolve_pin(sc,pin)
 else:
  if not re.fullmatch(r'soundcloud:playlists:\d+',identity):raise sc.APIError(400,'invalid_album')
  raw=cached(identity,lambda:sc.api('/playlists/'+quote(identity,safe=''),{'show_tracks':'true'}))
  pin=next((p for p in PINS if p['url']==raw.get('permalink_url')),None)
 album=normal(sc,raw,pin);items=raw.get('tracks')or[];missing=[str(t.get('id'))for t in items if not t.get('title')and t.get('id')]
 if missing:
  full=cached(album['id']+':tracks',lambda:sc.api('/tracks',{'ids':','.join(missing[:500])}));full=full.get('collection',[])if isinstance(full,dict)else full;byid={str(t.get('id')):t for t in full};items=[byid.get(str(t.get('id')),t)for t in items]
 tracks=[]
 for item in items:
  if item.get('access')!='playable'or not item.get('streamable'):continue
  try:track=sc.normalize_track(item)
  except sc.APIError:continue
  track.update(album=album['title'],collectionId=album['id'],releaseYear=album['year']);tracks.append(track)
 if not album['coverImg']and tracks:album['coverImg']=tracks[0]['coverImg']
 return {'album':album,'tracks':tracks,'hasMore':False}
def search(sc,query,offset=0,kind='albums'):
 query=str(query).strip()[:120];offset=max(0,min(int(offset),1000));items=[];more=False
 api_query=query
 if hasattr(sc,'smart_queries'):
  aliases,names=sc.smart_queries(query)
  if names and aliases:api_query=aliases[0]
 if kind=='artists':
  if len(query)<2:return {'artists':[],'tracks':[],'hasMore':False}
  raw=cached(('users',api_query.casefold(),offset),lambda:sc.api('/users',{'q':api_query,'limit':20,'offset':offset,'linked_partitioning':'true'}));rows=raw.get('collection',[])if isinstance(raw,dict)else raw
  return {'artists':[{'id':str(r.get('urn')or r.get('id')),'name':str(r.get('username')or''),'coverImg':sc.safe_url(r.get('avatar_url'))}for r in rows],'tracks':[],'hasMore':bool(raw.get('next_href'))if isinstance(raw,dict)else False,'nextOffset':offset+20}
 for pin in PINS:
  if offset==0 and(not query or query.casefold()in pin['keys'].casefold()):items.append(normal(sc,resolve_pin(sc,pin),pin))
 if len(query)>=2:
  raw=cached(('albums',api_query.casefold(),offset),lambda:sc.api('/playlists',{'q':api_query,'limit':25,'offset':offset,'linked_partitioning':'true'}));rows=raw.get('collection',[])if isinstance(raw,dict)else raw;more=bool(raw.get('next_href'))if isinstance(raw,dict)else False
  for row in rows:
   if row.get('is_album')is True or row.get('set_type')in('album','ep','single','compilation'):items.append(normal(sc,row))
 return {'albums':list({a['id']:a for a in items}.values()),'tracks':[],'hasMore':more,'nextOffset':offset+25}

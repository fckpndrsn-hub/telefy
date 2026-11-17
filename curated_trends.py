"""Only editorially approved sources. No AI, generated searches or automatic refresh."""
import json,hashlib,threading,re
from pathlib import Path
from urllib.parse import quote

LOCK=threading.Lock()
CONFIG=Path(__file__).with_name('trends-approved.json')

def discover(sc,offset=0,config_file=None):
 import profile_server
 cfg=json.loads((Path(config_file)if config_file else CONFIG).read_text(encoding='utf-8'));version=hashlib.sha256(json.dumps(cfg,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:16]
 d=profile_server.DB
 with LOCK:
  d.ensure()
  with d.connect()as c:d.execute(c,'CREATE TABLE IF NOT EXISTS telefy_curated_trends(version TEXT NOT NULL,source_key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(version,source_key))')
  def load(key):
   with d.connect()as c:row=d.execute(c,'SELECT payload FROM telefy_curated_trends WHERE version=%s AND source_key=%s',(version,key)).fetchone()
   return json.loads(row['payload'])if row else None
  def save(key,value):
   with d.connect()as c:d.execute(c,'INSERT INTO telefy_curated_trends VALUES(%s,%s,%s) ON CONFLICT(version,source_key) DO NOTHING',(version,key,json.dumps(value,ensure_ascii=False)))
  results=[];errors=[];source_stats={};work=0;pending=0;missing=0
  for slug in cfg.get('soundcloud',[]):
   items=load(slug)
   if items is None:
    if work:pending+=1;continue
    work=4
    try:
     raw=sc.api('/system-playlists/'+quote(slug,safe=''),{'access':'playable'})
     tracks=raw.get('tracks',[])
     if not isinstance(tracks,list)or not tracks:raise sc.APIError(502,'empty_source_playlist')
     # Resolve partial playlist track objects in one bounded bulk request.
     wanted={sc.track_urn(t.get('urn')or t.get('id'))for t in tracks}
     if any('title'not in t or'access'not in t for t in tracks):
      data=sc.api('/tracks',{'urns':','.join(sorted(wanted)),'access':'playable','limit':200});tracks=data.get('collection',[])if isinstance(data,dict)else data
     items=[]
     for t in tracks:
      if sc.track_urn(t.get('urn')or t.get('id'))not in wanted:continue
      if t.get('access')!='playable'or not t.get('streamable'):continue
      try:items.append(sc.normalize_track(t))
      except sc.APIError:continue
     save(slug,items)
    except sc.APIError as e:errors.append({'source':slug,'error':e.code});continue
   source_stats[slug]=len(items);results.extend(items)
  for i,album in enumerate(cfg.get('albums',[])):
   key='album:'+str(i);items=load(key)
   if items is None:
    if work>=4:pending+=1;continue
    work+=1
    try:
     found=sc.api('/playlists',{'q':album['artist']+' '+album['title'],'limit':10})
     norm=lambda v:''.join(sorted(sc.tokens(v)))
     matches=[p for p in found.get('collection',[])if norm(p.get('title',''))==norm(album['title'])and sc.tokens(album['artist']).issubset(sc.tokens((p.get('user')or{}).get('username','')))]
     if not matches:items=[]
     else:
      p=matches[0];full=sc.api('/playlists/'+quote(str(p.get('urn')or p['id']),safe=''));items=[]
      for raw in full.get('tracks',[]):
       if raw.get('access')!='playable'or not raw.get('streamable'):continue
       try:items.append(sc.normalize_track(raw))
       except sc.APIError:continue
     save(key,items)
    except sc.APIError as e:errors.append({'source':key,'error':e.code});pending+=1;continue
   for t in items:t['editorialYear']=album['year']
   results.extend(items)
  for i,seed in enumerate(cfg.get('tracks',cfg.get('spotify_tracks',[]))):
   key='spotify:'+str(i);items=load(key)
   if items is None:
    if work>=4:pending+=1;continue
    work+=1
    try:
     artist=seed['artist'].split(',')[0].strip();title=seed['title']
     data=sc.api('/tracks',{'q':artist+' '+title,'access':'playable','limit':25,'linked_partitioning':'true'})
     items=[]
     compact=lambda v:''.join(sorted(sc.tokens(v)))
     for raw in data.get('collection',[]):
      if raw.get('access')!='playable'or not raw.get('streamable'):continue
      try:t=sc.normalize_track(raw)
      except sc.APIError:continue
      if compact(title)!=compact(t['title']):continue
      if not sc.tokens(artist).issubset(sc.tokens(t['artist'])):continue
      items.append(t)
     items=sorted(items,key=lambda t:t.get('playbackCount',0),reverse=True)[:1];save(key,items)
    except sc.APIError as e:errors.append({'source':key,'error':e.code});pending+=1;continue
   if not items:missing+=1
   for t in items:
    if seed.get('year'):t['editorialYear']=seed['year']
   results.extend(items)
  unique={t['soundcloudUrn']:t for t in results}
  for t in unique.values():
   t['curatedTrend']=True;t['trendsEligible']=True;t['classificationVersion']=4
   mode='night'if cfg.get('name')=='night'else'underground'
   if mode not in t.setdefault('modes',[]):t['modes'].append(mode)
  sc.MODE_DIAGNOSTICS[cfg.get('name','curated')]={'version':version,'sources':source_stats,'totalSeeds':len(cfg.get('tracks',cfg.get('spotify_tracks',[]))),'pending':pending,'notFound':missing,'available':len(unique),'errors':errors,'ai':False}
  if not unique and errors:raise sc.APIError(502,'curated_sources_unavailable')
  # Client owns a shuffled cycle. Every reply contains only the frozen approved pool.
  output=list(unique.values())
  if cfg.get('name')=='hits':output.sort(key=lambda t:-int(t.get('editorialYear',0)))
  return {'tracks':output,'hasMore':pending>0,'nextOffset':int(offset)+1,'selection':'curated-only','importPending':pending,'version':version}

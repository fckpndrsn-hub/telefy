"""Shared metadata denylist; applied to canonical SoundCloud records before streaming."""
import re,unicodedata
PATTERNS=[r'росси[а-я]*',r'украин[а-я]*',r'путин[а-я]*',r'хуйл[а-я]*',r'пидор[а-я]*',r'пидар[а-я]*',r'russi[a-z]*',r'rossi[a-z]*',r'rossiy[a-z]*',r'ukrain[a-z]*',r'ukrayin[a-z]*',r'putin[a-z]*',r'khuylo[a-z]*',r'huylo[a-z]*',r'huilo[a-z]*',r'pidor[a-z]*',r'pidar[a-z]*']
MATCH=re.compile('(?:'+'|'.join(PATTERNS)+')')
CONFUSABLES=str.maketrans(dict(zip('abcehkmoptxy','авсенкмортху')))
def text_blocked(value):
 s=unicodedata.normalize('NFKC',str(value or'')).casefold().replace('ё','е');s=''.join(c for c in s if unicodedata.category(c)not in('Cf','Mn'))
 for word in re.findall(r'[a-zа-я0-9]+',s):
  if re.search('[а-я]',word):word=word.translate(CONFUSABLES)
  if MATCH.fullmatch(word):return True
 return False
FIELDS=('title','artist','primaryArtist','album','name','displayName','username','album_title')
def blocked(item):
 if isinstance(item,str):return text_blocked(item)
 if not isinstance(item,dict):return False
 return any(text_blocked(item.get(k))for k in FIELDS if isinstance(item.get(k),(str,int)))or blocked(item.get('publisher_metadata'))
def clean(data):
 if isinstance(data,list):return [clean(v)for v in data if not blocked(v)]
 if isinstance(data,dict):return {k:clean(v)if isinstance(v,(list,dict))else v for k,v in data.items()}
 return data

def install(sc):
 original_normal=sc.normalize_track;original_resolve=sc.resolve_track;original_search=sc.search;original_discovery=sc.discovery;original_freshmen=sc.freshmen
 def normal(raw):
  if blocked(raw):raise sc.APIError(403,'content_blocked')
  item=original_normal(raw)
  if blocked(item):raise sc.APIError(403,'content_blocked')
  return item
 def resolve(data):
  item=original_resolve(data)
  if blocked(item):raise sc.APIError(403,'content_blocked')
  return item
 def search(query,offset=0,limit=25):
  if text_blocked(query):return {'tracks':[],'albums':[],'artists':[],'hasMore':False,'nextOffset':offset}
  data=original_search(query,offset,limit)
  if isinstance(data,dict)and blocked(data.get('album')):raise sc.APIError(403,'content_blocked')
  return clean(data)
 sc.normalize_track=normal;sc.resolve_track=resolve;sc.search=search
 sc.discovery=lambda *a,**k:clean(original_discovery(*a,**k))
 sc.freshmen=lambda *a,**k:clean(original_freshmen(*a,**k))

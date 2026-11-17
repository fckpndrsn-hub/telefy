"""Authenticated routes for music export and Gemini integration."""
import json
from urllib.parse import urlsplit,parse_qs

class MusicMixin:
 def do_GET(self):
  route=urlsplit(self.path)
  if route.path not in('/api/music/export','/api/ai/status','/api/ai/recent'):return super().do_GET()
  user=self.bot_user()
  if not user:return
  if route.path=='/api/ai/recent':
   import profile_server
   self.reply(200,{'history':profile_server.DB.taste_recent(user['telegram_id'])});return
  if route.path=='/api/ai/status':
   import openai_music
   self.reply(200,openai_music.status());return
  import music_export
  pid=parse_qs(route.query).get('id',[''])[0]
  if len(pid)>64:self.reply(400,{'error':'invalid_job'});return
  row=music_export.store().get(user['telegram_id'],pid)
  if not row:self.reply(404,{'error':'job_not_found'});return
  self.reply(200,{k:row[k]for k in('id','status','error')})
 def do_POST(self):
  path=urlsplit(self.path).path
  if path not in('/api/music/export','/api/ai/description','/api/ai/rank'):return super().do_POST()
  if not self.same_origin():self.reply(403,{'error':'origin_rejected'});return
  user=self.bot_user()
  if not user:return
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<=50000 or not self.headers.get('Content-Type','').startswith('application/json'):raise ValueError()
   data=json.loads(self.rfile.read(size))
   if not isinstance(data,dict):raise ValueError()
   if path=='/api/music/export':
    import music_export,bot_reminders,telefy_bot as bot
    if not bot_reminders.store().prefs(user['telegram_id'])['chat_started']:self.reply(409,{'error':'bot_start_required'});return
    row=music_export.store().enqueue(user['telegram_id'],data.get('soundcloudUrn'))
    self.reply(202,{'id':row['id'],'status':row['status'],'error':row['error']});return
   import openai_music
   if path=='/api/ai/description':result=openai_music.description(data,data.get('lang','ru'))
   else:
    candidates=data.get('candidates')
    if not isinstance(candidates,list)or len(candidates)>60 or any(not isinstance(t,dict)for t in candidates):raise ValueError()
    result=openai_music.rank(user['telegram_id'],candidates,data.get('context','vibe'))
   self.reply(200,result)
  except ValueError as error:
   code=str(error)
   if code=='export_limit':self.reply(403,{'error':'export_limit'});return
   if code in('queue_busy','export_cooldown','export_in_progress'):self.reply(429,{'error':code})
   else:self.reply(400,{'error':'invalid_request'})
  except TypeError:self.reply(400,{'error':'invalid_request'})
  except Exception:self.reply(503,{'error':'music_feature_unavailable'})

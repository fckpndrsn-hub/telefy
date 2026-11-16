"""Private aggregate metrics and persistent Mini App maintenance/reload controls."""
import time,threading,secrets,json

LOCK=threading.Lock()

def store():
 import bot_reminders as rem
 root=rem.store();root.ensure();db=root.db
 with LOCK:
  if not getattr(db,'operations_store',None):db.operations_store=OperationsStore(db)
  s=db.operations_store
 s.ensure();return s

class OperationsStore:
 def __init__(self,db):self.db=db;self.ready=False;self.lock=threading.Lock();self.cached=None;self.cache_at=0
 def ensure(self):
  with self.lock:
   if self.ready:return
   with self.db.connect()as c:
    if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620115)')
    for sql in [
     '''CREATE TABLE IF NOT EXISTS telefy_app_control(id INTEGER PRIMARY KEY,maintenance INTEGER NOT NULL,generation BIGINT NOT NULL,updated_at BIGINT NOT NULL,updated_by BIGINT NOT NULL)''',
     '''CREATE TABLE IF NOT EXISTS telefy_bot_contacts(telegram_id BIGINT PRIMARY KEY,first_seen BIGINT NOT NULL,last_seen BIGINT NOT NULL,blocked INTEGER NOT NULL)''',
     '''CREATE TABLE IF NOT EXISTS telefy_ops_confirm(token TEXT PRIMARY KEY,admin_id BIGINT NOT NULL,operation TEXT NOT NULL,expires_at BIGINT NOT NULL)''']:
     self.db.execute(c,sql)
    self.db.execute(c,'INSERT INTO telefy_app_control VALUES(1,0,0,0,0) ON CONFLICT(id) DO NOTHING')
    # Known bot contacts only; the time of older /start messages is unknown.
    self.db.execute(c,'INSERT INTO telefy_bot_contacts SELECT telegram_id,0,0,0 FROM telefy_reminder_contacts WHERE chat_started=1 ON CONFLICT(telegram_id) DO NOTHING')
   self.ready=True
 def status(self,fresh=False):
  with self.lock:
   if not fresh and self.cached and time.monotonic()-self.cache_at<2:return dict(self.cached)
   with self.db.connect()as c:r=self.db.execute(c,'SELECT maintenance,generation FROM telefy_app_control WHERE id=1').fetchone()
   self.cached={'maintenance':bool(r['maintenance']),'generation':r['generation']};self.cache_at=time.monotonic();return dict(self.cached)
 def contact(self,uid,blocked=None,now=None,interacted=True):
  now=int(time.time())if now is None else now
  with self.db.connect()as c:
   self.db.execute(c,'INSERT INTO telefy_bot_contacts VALUES(%s,%s,%s,%s) ON CONFLICT(telegram_id) DO UPDATE SET last_seen=CASE WHEN %s THEN excluded.last_seen ELSE telefy_bot_contacts.last_seen END,blocked=CASE WHEN %s THEN excluded.blocked ELSE telefy_bot_contacts.blocked END',(uid,now,now if interacted else 0,int(bool(blocked)),interacted,blocked is not None))
 def metrics(self,now=None):
  now=int(time.time())if now is None else now
  with self.db.connect()as c:
   users=self.db.execute(c,'SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN created_at>=%s THEN 1 ELSE 0 END),0) AS new_day FROM telefy_users',(now-86400,)).fetchone()
   contacts=self.db.execute(c,'SELECT COUNT(*) AS total,COALESCE(SUM(blocked),0) AS blocked,COALESCE(SUM(CASE WHEN last_seen>=%s THEN 1 ELSE 0 END),0) AS active_day FROM telefy_bot_contacts',(now-86400,)).fetchone()
   app=self.db.execute(c,'SELECT COALESCE(SUM(CASE WHEN last_app_at>0 AND last_app_at>=%s THEN 1 ELSE 0 END),0) AS day,COALESCE(SUM(CASE WHEN last_app_at>0 AND last_app_at>=%s THEN 1 ELSE 0 END),0) AS week,COALESCE(SUM(CASE WHEN chat_started=1 AND enabled=1 AND reachable=1 THEN 1 ELSE 0 END),0) AS eligible,COALESCE(SUM(CASE WHEN chat_started=1 AND enabled=0 THEN 1 ELSE 0 END),0) AS opted_out FROM telefy_reminder_contacts',(now-86400,now-7*86400)).fetchone()
  return {'profiles':users['total'],'new_profiles_day':users['new_day'],'bot_contacts':contacts['total'],'blocked':contacts['blocked'],'bot_active_day':contacts['active_day'],'app_active_day':app['day'],'app_active_week':app['week'],'eligible':app['eligible'],'opted_out':app['opted_out']}
 def confirm(self,uid,op):
  if op not in('off','on','reload'):raise ValueError()
  token=secrets.token_hex(8);now=int(time.time())
  with self.db.connect()as c:
   self.db.execute(c,'DELETE FROM telefy_ops_confirm WHERE expires_at<%s',(now,))
   self.db.execute(c,'INSERT INTO telefy_ops_confirm VALUES(%s,%s,%s,%s)',(token,uid,op,now+600))
  return token
 def apply(self,uid,token):
  with self.db.connect()as c:
   r=self.db.execute(c,'SELECT operation FROM telefy_ops_confirm WHERE token=%s AND admin_id=%s AND expires_at>%s'+(' FOR UPDATE'if self.db.url else ''),(token,uid,int(time.time()))).fetchone()
   if not r:return False
   deleted=self.db.execute(c,'DELETE FROM telefy_ops_confirm WHERE token=%s AND admin_id=%s',(token,uid))
   if deleted.rowcount!=1:return False
   if r['operation']=='reload':self.db.execute(c,'UPDATE telefy_app_control SET generation=generation+1,updated_at=%s,updated_by=%s WHERE id=1',(int(time.time()),uid))
   else:self.db.execute(c,'UPDATE telefy_app_control SET maintenance=%s,generation=generation+1,updated_at=%s,updated_by=%s WHERE id=1',(int(r['operation']=='off'),int(time.time()),uid))
  with self.lock:self.cached=None
  return True

def record(update):
 import telefy_bot as bot
 msg=update.get('message')or{};cb=update.get('callback_query')or{};own=update.get('my_chat_member')or{}
 if own.get('chat',{}).get('type')=='private':
  uid=own['chat'].get('id')
  if type(uid)is int and uid>0:store().contact(uid,blocked=(own.get('new_chat_member')or{}).get('status')in('kicked','left'),interacted=False)
 user=msg.get('from')or cb.get('from')or{};chat=(msg or cb.get('message')or{}).get('chat')or{}
 if chat.get('type')=='private'and bot.valid_user(user):
  bot.store().remember(user);store().contact(user['id'],blocked=False)

def panel(uid):
 import bot_posts as posts
 s=store().status(fresh=True)
 posts.say(uid,'Mini App: '+('технические работы 🛠'if s['maintenance']else'работает 🟢'),[[posts.button('📊 Сводка пользователей','ops_stats')],[posts.button('🔄 Перезагрузить Mini App','ops_reload')],[posts.button('🛠 Выключить на техработы','ops_off')if not s['maintenance']else posts.button('🟢 Включить Telefy','ops_on')],[posts.button('Назад','post_menu')]])

def handle(update):
 import telefy_bot as bot,bot_reminders as rem,bot_posts as posts
 cb=update.get('callback_query')or{};msg=update.get('message')or{};u=cb.get('from')or msg.get('from')or{}
 chat=(cb.get('message')or msg).get('chat')or{};data=cb.get('data','');command=msg.get('text','').split(' ',1)[0].split('@')[0]
 if not(data.startswith('ops_')or command in('/stats','/app_admin')):return False
 if not bot.valid_user(u)or chat.get('type')!='private':return True
 uid=u['id']
 if uid not in rem.admins():
  if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Только для администратора',show_alert=True)
  else:posts.say(uid,'Только для администратора. Проверка: /id')
  return True
 if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'])
 if command=='/stats'or data=='ops_stats':
  m=store().metrics()
  text=('📊 Telefy · Сводка\n\nПрофилей в БД: {profiles}\nНовых профилей за 24 ч: {new_profiles_day}\n\nПользователей бота: {bot_contacts}\nАктивны в боте за 24 ч: {bot_active_day}\nЗаблокировали бота (известно): {blocked}\n\nОткрывали приложение за 24 ч: {app_active_day}\nЗа 7 дней: {app_active_week}\n\nДоступны для сообщений до проверки подписки: {eligible}\nОтключили сообщения: {opted_out}').format(**m)
  posts.say(uid,text,[[posts.button('Обновить','ops_stats'),posts.button('Mini App','ops_menu')]]);return True
 if data.startswith('ops_apply:'):
  ok=store().apply(uid,data.split(':',1)[1]);posts.say(uid,'Команда применена ✅'if ok else'Подтверждение уже использовано или истекло.');panel(uid);return True
 if data in('ops_reload','ops_off','ops_on'):
  op=data[4:];token=store().confirm(uid,op)
  text={'reload':'Перезагрузить открытые страницы Mini App? Музыка остановится, страницы обновятся при ближайшей проверке (обычно до 15 секунд). Данные в БД сохранятся. Это обновление страниц, а не перезапуск сервера Render.','off':'Выключить Mini App на технические работы? Пользователи увидят предупреждение, воспроизведение остановится при ближайшей проверке. Админка бота останется доступна.','on':'Снять технические работы и снова открыть Telefy пользователям?'}[op]
  posts.say(uid,text,[[posts.button('Подтвердить','ops_apply:'+token)],[posts.button('Отмена','ops_menu')]]);return True
 panel(uid);return True

def maintenance_page():
 return '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Telefy · Технические работы</title><style>:root{font-family:system-ui,-apple-system,sans-serif;color-scheme:light dark}body{margin:0;background:#f2f2f7;color:#17212b;display:grid;place-items:center;min-height:100dvh}main{padding:32px;max-width:360px;text-align:center}.brand{display:inline-block;background:#2aabee;color:white;border-radius:24px;padding:10px 24px;font-size:26px;font-weight:750}h1{font-size:25px;margin:28px 0 14px}p{color:#798591;line-height:1.5}button{background:#2aabee;color:white;border:0;border-radius:14px;padding:14px 24px;font:600 16px system-ui}button:disabled{opacity:.6}@media(prefers-color-scheme:dark){body{background:#0e1621;color:white}}</style><main><span class="brand">Telefy</span><h1>Telefy на технических работах</h1><p>Скоро вернёмся. Твоя музыка и плейлисты сохранены.</p><button id="check">Проверить ещё раз</button></main><script>let busy=false;async function check(){if(busy)return;busy=true;document.getElementById('check').disabled=true;try{const r=await fetch('/api/app/status',{cache:'no-store'});if(r.ok&&!(await r.json()).maintenance)location.reload();}catch(_){}finally{busy=false;document.getElementById('check').disabled=false;}}document.getElementById('check').onclick=check;setInterval(check,15000);</script></html>'''

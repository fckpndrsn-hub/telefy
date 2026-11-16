"""Inactivity reminders and private admin media uploads. No binary files on Render."""
import os,time,threading
from reminder_store import ReminderStore,STAGES

TEXTS={
 '48h':'Твоя музыка заждалась 🎧 Загляни в Telefy — выбери трек под настроение.',
 '3d':'Что сегодня на повторе? 🎵 Открой Telefy и найди свой следующий любимый трек.',
 '7d':'Давно не слушались 🎶 Твой вайб — в Telefy.',
 '14d':'Самое время сменить саундтрек ✨ Загляни в Telefy за музыкой под настроение.',
 '1m':'Telefy на связи 🎧 Заходи, когда захочется музыки.'}
LABELS={'48h':'48 часов','3d':'3 дня','7d':'7 дней','14d':'14 дней','1m':'1 месяц'}
LOCK=threading.Lock();STARTED=False
def admins():
 result=set()
 for value in os.environ.get('TELEFY_ADMIN_IDS','').replace(';',',').split(','):
  try:
   uid=int(value.strip())
   if 0<uid<2**53:result.add(uid)
  except ValueError:pass
 return result
def enabled():return os.environ.get('TELEFY_REMINDERS_ENABLED','true').lower()not in('false','0','off')
def store():
 import telefy_bot as bot
 root=bot.store();root.ensure();db=root.db
 with LOCK:
  if not getattr(db,'reminder_store',None):db.reminder_store=ReminderStore(db)
  return db.reminder_store
def register(uid):store().register(uid)
def buttons():
 import telefy_bot as bot
 return {'inline_keyboard':[[{'text':'Открыть Telefy','web_app':{'url':bot.BASE+'/telefy.html'}}],[{'text':'Не напоминать','callback_data':'reminders_off'}]]}
def send(uid,stage):
 import telefy_bot as bot
 media=store().media(stage);common={'chat_id':uid,'reply_markup':buttons()}
 if media:
  methods={'photo':'sendPhoto','video':'sendVideo','animation':'sendAnimation','audio':'sendAudio','document':'sendDocument'}
  try:bot.api(methods[media['kind']],**common,**{media['kind']:media['file_id']},caption=TEXTS[stage]);return 'sent_media'
  except bot.BotError as e:
   if not(e.definitive and e.status==400):raise
 bot.api('sendMessage',**common,text=TEXTS[stage]);return 'sent_text'
def run_one(now=None):
 import telefy_bot as bot
 now=int(time.time())if now is None else int(now)
 if not enabled()or not bot.enabled():return False
 s=store();row=s.candidate(now)
 if not row:return False
 try:
  if not bot.subscribed(row['telegram_id']):s.reachable(row['telegram_id'],False);return True
 except Exception:s.defer(row['telegram_id'],row['cycle'],now+300);return True
 job=s.reserve(row,now)
 if not job:return True
 if not s.current(job):s.finish(job,'cancelled',now=now);return True
 try:s.finish(job,send(job['uid'],STAGES[job['stage']]),now=now)
 except bot.BotError as e:
  if e.definitive and e.status==429:s.finish(job,'rate_limited',retry=e.retry_after,now=now)
  elif e.definitive and e.status in(400,403):s.reachable(job['uid'],False);s.finish(job,'unreachable',now=now)
  else:s.finish(job,'uncertain',now=now)
 except Exception:s.finish(job,'uncertain',now=now)
 return True
def start():
 global STARTED
 if STARTED:return
 STARTED=True
 def worker():
  enrolled=False
  while True:
   try:
    import telefy_bot as bot
    if enabled()and bot.DIAGNOSTIC.get('state')=='ready':
     if not enrolled:store().enroll_known();enrolled=True
     for _ in range(50):
      if not run_one():break
      time.sleep(.25)
   except Exception:pass
   time.sleep(30)
 threading.Thread(target=worker,name='telefy-reminders',daemon=True).start()
def admin_panel(uid,stage=None):
 import telefy_bot as bot
 if uid not in admins():bot.api('sendMessage',chat_id=uid,text='Этот раздел доступен администратору Telefy.');return
 if stage is None:
  bot.api('sendMessage',chat_id=uid,text='Напоминания Telefy: выбери этап, затем отправь своё медиа.',reply_markup={'inline_keyboard':[[{'text':LABELS[s],'callback_data':'rm_stage:'+s}]for s in STAGES]});return
 if stage not in STAGES:return
 s=store();s.upload_stage(uid,stage);media=s.media(stage)
 text='Напоминание: '+LABELS[stage]+'\n\n'+TEXTS[stage]+'\n\nМедиа: '+(media['kind']if media else'не добавлено')+'\nПришли фото, видео, GIF, аудио или файл. Ожидание — 10 минут.'
 bot.api('sendMessage',chat_id=uid,text=text,reply_markup={'inline_keyboard':[[{'text':'Предпросмотр','callback_data':'rm_preview:'+stage},{'text':'Убрать медиа','callback_data':'rm_clear:'+stage}],[{'text':'Отмена загрузки','callback_data':'rm_cancel'}]]})
def handle(update):
 import telefy_bot as bot
 own=update.get('my_chat_member')or{}
 if own.get('chat',{}).get('type')=='private':
  uid=own['chat'].get('id')
  if type(uid)is int:store().reachable(uid,(own.get('new_chat_member')or{}).get('status')not in('kicked','left'))
 event=update.get('chat_member')or{}
 if event and bot.same_channel(event.get('chat',{})):
  new=event.get('new_chat_member')or{};u=new.get('user')or{}
  if bot.valid_user(u):store().reachable(u['id'],bot.active(new))
 callback=update.get('callback_query')or{};user=callback.get('from')or{};data=callback.get('data','')
 if callback and bot.valid_user(user)and(data=='reminders_off'or data.startswith('rm_')):
  uid=user['id']
  if(callback.get('message')or{}).get('chat',{}).get('type')!='private':return True
  if data=='reminders_off':
   bot.store().remember(user);store().toggle(uid,False);bot.api('answerCallbackQuery',callback_query_id=callback['id'],text='Напоминания отключены. Включить: /remind');return True
  if uid not in admins():bot.api('answerCallbackQuery',callback_query_id=callback['id'],text='Только для администратора',show_alert=True);return True
  command,_,stage=data.partition(':')
  if command=='rm_cancel':store().cancel_upload(uid);bot.api('answerCallbackQuery',callback_query_id=callback['id'],text='Загрузка отменена');return True
  if stage not in STAGES:return True
  bot.api('answerCallbackQuery',callback_query_id=callback['id'])
  if command=='rm_stage':admin_panel(uid,stage)
  elif command=='rm_clear':store().clear_media(stage);store().cancel_upload(uid);bot.api('sendMessage',chat_id=uid,text='Медиа удалено. Напоминание будет текстовым.')
  elif command=='rm_preview':send(uid,stage)
  return True
 message=update.get('message')or{};user=message.get('from')or{}
 if message.get('chat',{}).get('type')!='private'or not bot.valid_user(user):return False
 uid=user['id'];command=message.get('text','').split(' ',1)[0].split('@')[0]
 if command=='/id':bot.api('sendMessage',chat_id=uid,text='Твой Telegram ID: '+str(uid));return True
 if command in('/stop','/remind'):
  bot.store().remember(user);store().register(uid);store().toggle(uid,command=='/remind')
  bot.api('sendMessage',chat_id=uid,text='Напоминания включены 🎧'if command=='/remind'else'Напоминания отключены. Включить снова: /remind');return True
 if command in('/reminders_admin','/reminder_media'):admin_panel(uid);return True
 if command.startswith('/'):return False
 if uid not in admins():return False
 stage=store().pending_upload(uid)
 if not stage:return False
 media=None
 for kind in('photo','animation','video','audio','document'):
  value=message.get(kind)
  if kind=='photo'and isinstance(value,list)and value:value=value[-1]
  if isinstance(value,dict)and isinstance(value.get('file_id'),str):media=(kind,value['file_id']);break
 if not media:bot.api('sendMessage',chat_id=uid,text='Пришли фото, видео, GIF, аудио или файл для этапа «'+LABELS[stage]+'».');return True
 store().set_media(stage,*media,uid);bot.api('sendMessage',chat_id=uid,text='Медиа сохранено для этапа «'+LABELS[stage]+'» ✅',reply_markup={'inline_keyboard':[[{'text':'Посмотреть сообщение','callback_data':'rm_preview:'+stage}]]});return True

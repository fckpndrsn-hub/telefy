"""Inactivity reminders and private admin media uploads. No binary files on Render."""
import os,time,threading,re,json
from reminder_store import ReminderStore,STAGES,MEDIA_STAGES

TEXTS={
 '48h':'Твоя музыка заждалась 🎧 Загляни в Telefy — выбери трек под настроение.',
 '3d':'Что сегодня на повторе? 🎵 Открой Telefy и найди свой следующий любимый трек.',
 '7d':'Давно не слушались 🎶 Твой вайб — в Telefy.',
 '14d':'Самое время сменить саундтрек ✨ Загляни в Telefy за музыкой под настроение.',
 '1m':'Telefy на связи 🎧 Заходи, когда захочется музыки.'}
LABELS={'welcome':'👋 Приветствие','48h':'48 часов','3d':'3 дня','7d':'7 дней','14d':'14 дней','1m':'1 месяц'}
LOCK=threading.Lock();STARTED=False
def admins():
 raw=os.environ.get('TELEFY_ADMIN_IDS','').strip()
 # Accept pasted JSON lists, quotes and whitespace, without extracting IDs
 # from arbitrary text or treating an absent setting as authorization.
 if not raw:return set()
 try:
  values=json.loads(raw)
  if not isinstance(values,list):values=[values]
 except (ValueError,TypeError):values=re.split(r'[,;\s]+',raw)
 result=set()
 for value in values:
  if type(value)is int:uid=value
  elif isinstance(value,str)and re.fullmatch(r'[0-9]+',value.strip().strip('\"\'')):
   uid=int(value.strip().strip('\"\''))
  else:continue
  if 0<uid<2**53:result.add(uid)
 return result

def admin_status(uid):
 raw=os.environ.get('TELEFY_ADMIN_IDS','').strip();allowed=admins()
 if uid in allowed:return 'Доступ администратора: включён ✅'
 if not raw:return 'Доступ администратора: выключен. Запущенный бот не видит TELEFY_ADMIN_IDS.'
 if not allowed:return 'Доступ администратора: выключен. TELEFY_ADMIN_IDS задана, но числовой ID не распознан.'
 return 'Доступ администратора: выключен. В TELEFY_ADMIN_IDS распознан другой ID.'
def enabled():return os.environ.get('TELEFY_REMINDERS_ENABLED','true').lower()not in('false','0','off')
def store():
 import telefy_bot as bot
 root=bot.store();root.ensure();db=root.db
 with LOCK:
  if not getattr(db,'reminder_store',None):db.reminder_store=ReminderStore(db)
  return db.reminder_store
def register(uid):store().register(uid)

def custom_text(stage):
 import bot_posts
 return bot_posts.store().text(stage)
def buttons():
 import telefy_bot as bot
 import bot_buttons
 return {'inline_keyboard':[[bot_buttons.make('open',web_app={'url':bot.BASE+'/telefy.html'})],[bot_buttons.make('optout',callback_data='reminders_off')]]}
def send(uid,stage):
 import telefy_bot as bot
 media=store().media(stage);text=custom_text(stage)or TEXTS[stage];common={'chat_id':uid,'reply_markup':buttons()}
 if media:
  methods={'photo':'sendPhoto','video':'sendVideo','animation':'sendAnimation','audio':'sendAudio','document':'sendDocument'}
  try:bot.api(methods[media['kind']],**common,**{media['kind']:media['file_id']},caption=text);return 'sent_media'
  except bot.BotError as e:
   if not(e.definitive and e.status==400):raise
 bot.api('sendMessage',**common,text=text);return 'sent_text'
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
      import bot_posts
      reminder=run_one();post=bot_posts.run_one()
      if not reminder and not post:break
      time.sleep(.25)
   except Exception:pass
   time.sleep(30)
 threading.Thread(target=worker,name='telefy-reminders',daemon=True).start()
def admin_panel(uid,stage=None):
 import telefy_bot as bot
 if uid not in admins():bot.api('sendMessage',chat_id=uid,text='Этот раздел доступен администратору Telefy.\n\n'+admin_status(uid)+'\nТвой Telegram ID: '+str(uid)+'\nДиагностика: /id');return
 if stage is None:
  bot.api('sendMessage',chat_id=uid,text='Сообщения Telefy: выбери приветствие или напоминание. Можно изменить текст и медиа.',reply_markup={'inline_keyboard':[[{'text':LABELS[s],'callback_data':'rm_stage:'+s}]for s in MEDIA_STAGES]+[[{'text':'📣 Посты и рассылки','callback_data':'post_menu'}]]});return
 if stage not in MEDIA_STAGES:return
 s=store();s.upload_stage(uid,stage);media=s.media(stage)
 body=custom_text(stage)or(TEXTS[stage]if stage!='welcome'else'Стандартное приветствие после /start. Имя подставляется автоматически.')
 text='Сообщение: '+LABELS[stage]+'\n\n'+body+'\n\nМедиа: '+(media['kind']if media else'не добавлено')+'\nПришли фото, видео, GIF, аудио или файл. Ожидание — 10 минут.'
 bot.api('sendMessage',chat_id=uid,text=text,reply_markup={'inline_keyboard':[[{'text':'✏️ Изменить текст','callback_data':'rm_text:'+stage},{'text':'Стандартный текст','callback_data':'rm_reset:'+stage}],[{'text':'Предпросмотр','callback_data':'rm_preview:'+stage},{'text':'Убрать медиа','callback_data':'rm_clear:'+stage}],[{'text':'Отмена загрузки','callback_data':'rm_cancel'}]]})
def handle(update):
 import telefy_bot as bot
 import bot_posts
 if bot_posts.handle(update):return True
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
   bot.store().remember(user);store().toggle(uid,False);bot.api('answerCallbackQuery',callback_query_id=callback['id'],text='Сообщения и напоминания отключены. Включить: /remind');return True
  if uid not in admins():bot.api('answerCallbackQuery',callback_query_id=callback['id'],text='Только для администратора',show_alert=True);return True
  command,_,stage=data.partition(':')
  bot_posts.store().cancel_input(uid)
  if command=='rm_cancel':store().cancel_upload(uid);bot.api('answerCallbackQuery',callback_query_id=callback['id'],text='Загрузка отменена');return True
  if stage not in MEDIA_STAGES:return True
  bot.api('answerCallbackQuery',callback_query_id=callback['id'])
  if command=='rm_stage':admin_panel(uid,stage)
  elif command=='rm_text':store().cancel_upload(uid);bot_posts.store().input(uid,'template',stage);bot.api('sendMessage',chat_id=uid,text='Пришли новый текст с эмоджи — до 1024 символов. Для приветствия можно использовать {name}. Форматирование обычным текстом. Отмена: /cancel')
  elif command=='rm_reset':bot_posts.store().reset_text(stage);store().cancel_upload(uid);bot.api('sendMessage',chat_id=uid,text='Стандартный текст восстановлен.')
  elif command=='rm_clear':store().clear_media(stage);store().cancel_upload(uid);bot.api('sendMessage',chat_id=uid,text='Медиа удалено. Сообщение будет текстовым.')
  elif command=='rm_preview':bot.send_welcome(user,preview=True)if stage=='welcome'else send(uid,stage)
  return True
 message=update.get('message')or{};user=message.get('from')or{}
 if message.get('chat',{}).get('type')!='private'or not bot.valid_user(user):return False
 uid=user['id'];command=message.get('text','').split(' ',1)[0].split('@')[0]
 if command=='/id':bot.api('sendMessage',chat_id=uid,text='Твой Telegram ID: '+str(uid)+'\n'+admin_status(uid)+'\nВерсия проверки: admin-access-v2');return True
 if command in('/stop','/remind'):
  bot.store().remember(user);store().register(uid);store().toggle(uid,command=='/remind')
  bot.api('sendMessage',chat_id=uid,text='Сообщения и напоминания включены 🎧'if command=='/remind'else'Сообщения и напоминания отключены. Включить снова: /remind');return True
 if command in('/reminders_admin','/reminder_media'):
  if uid in admins():bot_posts.store().cancel_input(uid);store().cancel_upload(uid)
  admin_panel(uid);return True
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

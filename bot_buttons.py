"""Validated Telegram button appearance, with actions kept in application code."""
import re

DEFAULTS={'home':'🎧 Открыть Mini App','profile':'👤 Мой профиль','settings':'⚙️ Настройки','max':'⭐ Telefy Max','support':'💬 Поддержка','open':'Открыть Telefy','join':'Подписаться на канал','check':'Проверить подписку','optout':'Не присылать сообщения'}
COLORS={'default':'Стандартный','primary':'🔵 Синий','success':'🟢 Зелёный','danger':'🔴 Красный'}

def make(key,text=None,**action):
 import bot_posts
 cfg=bot_posts.store().button(key)
 button={'text':cfg.get('text')or text or DEFAULTS[key],**action}
 if cfg.get('style')in('primary','success','danger'):button['style']=cfg['style']
 if re.fullmatch(r'[0-9]{1,32}',cfg.get('emoji','')):button['icon_custom_emoji_id']=cfg['emoji']
 return button

def save(key,field,value):
 import bot_posts
 if key not in DEFAULTS:raise ValueError()
 if field=='text':
  if not isinstance(value,str)or not value.strip()or bot_posts.text_size(value)>64:raise ValueError()
 elif field=='style':
  if value not in COLORS:raise ValueError()
 elif field=='emoji':
  if value and not re.fullmatch(r'[0-9]{1,32}',value):raise ValueError()
 else:raise ValueError()
 cfg=bot_posts.store().button(key);cfg[field]=value;bot_posts.store().button(key,cfg)

def panel(uid,key=None):
 import bot_posts as posts
 import telefy_bot as bot
 if key is None:
  return posts.say(uid,'Выбери кнопку. Изменения применяются к новым сообщениям. Нижнее меню обновится после /start.',[[posts.button(DEFAULTS[k],'btn_edit:'+k)]for k in DEFAULTS])
 if key not in DEFAULTS:return
 before=bot.DIAGNOSTIC.get('button_icon_fallbacks',0)
 posts.say(uid,'Настройка: '+DEFAULTS[key],[[make(key,callback_data='btn_preview')],[posts.button('✏️ Название','btn_text:'+key),posts.button('💎 Premium-эмоджи','btn_emoji:'+key)],[posts.button(name,'btn_color:'+key+':'+color)for color,name in list(COLORS.items())[:2]],[posts.button(name,'btn_color:'+key+':'+color)for color,name in list(COLORS.items())[2:]],[posts.button('Убрать premium-эмоджи','btn_clear:'+key)],[posts.button('Сбросить кнопку','btn_reset:'+key),posts.button('Назад','btn_menu')]])
 if bot.DIAGNOSTIC.get('button_icon_fallbacks',0)>before:posts.say(uid,'Telegram отклонил premium-иконку. Пример отправлен без неё. Проверь ID эмоджи и Premium у владельца бота.')

def handle(update):
 import bot_posts as posts,bot_reminders as rem,telefy_bot as bot
 cb=update.get('callback_query')or{};msg=update.get('message')or{};u=cb.get('from')or msg.get('from')or{};chat=(cb.get('message')or msg).get('chat')or{}
 if not bot.valid_user(u)or chat.get('type')!='private':return False
 uid=u['id'];data=cb.get('data','');command=msg.get('text','').split(' ',1)[0].split('@')[0]
 relevant=data.startswith('btn_')or command=='/buttons_admin'
 if uid not in rem.admins():
  if relevant:
   if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Только для администратора',show_alert=True)
   else:posts.say(uid,'Только для администратора. Проверка: /id')
   return True
  return False
 s=posts.store()
 if command=='/buttons_admin':s.cancel_input(uid);rem.store().cancel_upload(uid);panel(uid);return True
 if cb and data.startswith('btn_'):
  bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Пример кнопки'if data=='btn_preview'else'')
  if data=='btn_preview':return True
  s.cancel_input(uid);rem.store().cancel_upload(uid)
  op,_,tail=data.partition(':');key,_,color=tail.partition(':')
  if op=='btn_menu':panel(uid);return True
  if key not in DEFAULTS:return True
  if op=='btn_edit':panel(uid,key)
  elif op=='btn_color':
   if color in COLORS:save(key,'style',color);panel(uid,key)
  elif op=='btn_clear':save(key,'emoji','');panel(uid,key)
  elif op=='btn_reset':s.button(key,reset=True);panel(uid,key)
  elif op in('btn_text','btn_emoji'):
   s.input(uid,'button_text'if op=='btn_text'else'button_emoji',key)
   posts.say(uid,'Пришли название кнопки — до 64 символов. Отмена: /cancel'if op=='btn_text'else'Пришли сообщение с одним premium-эмоджи, custom emoji-стикер или его числовой ID. Для показа premium-эмоджи Telegram требует Premium у владельца бота либо дополнительное имя бота через Fragment. Отмена: /cancel')
  return True
 if cb or command.startswith('/'):return False
 pending=s.input(uid)
 if not pending or pending['kind']not in('button_text','button_emoji'):return False
 key=pending['target']
 try:
  if pending['kind']=='button_text':save(key,'text',msg.get('text'))
  else:
   icons=[e.get('custom_emoji_id')for e in msg.get('entities',msg.get('caption_entities',[]))if e.get('type')=='custom_emoji']
   icon=icons[0]if icons else(msg.get('sticker')or{}).get('custom_emoji_id')or msg.get('text','').strip()
   save(key,'emoji',icon)
  s.cancel_input(uid);panel(uid,key)
 except (ValueError,TypeError):posts.say(uid,'Не удалось сохранить. Для названия — текст до 64 символов; для premium-иконки — custom emoji или его числовой ID. Попробуй ещё раз или /cancel.')
 return True

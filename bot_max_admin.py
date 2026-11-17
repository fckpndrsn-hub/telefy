"""Private admin username -> days -> explicit, one-use confirmation."""
import re,time,math
from datetime import datetime,timezone,timedelta
import max_grants
def date(value):return datetime.fromtimestamp(value,timezone(timedelta(hours=3))).strftime('%d.%m.%Y %H:%M МСК')
def handle(update):
 import max_gifts
 if max_gifts.admin(update):return True
 import bot_users
 if bot_users.handle(update):return True
 import telefy_bot as bot,bot_reminders as rem,bot_posts as posts,max_billing
 cb=update.get('callback_query')or{};msg=update.get('message')or{};user=cb.get('from')or msg.get('from')or{};chat=(cb.get('message')or msg).get('chat')or{}
 data=cb.get('data','');text=msg.get('text','').strip();command=text.split(' ',1)[0].split('@')[0];relevant=data.startswith('maxgrant_')or command=='/max_admin'
 if not bot.valid_user(user)or chat.get('type')!='private':return relevant
 uid=user['id']
 if uid not in rem.admins():
  if relevant:
   if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Только для администратора',show_alert=True)
   else:posts.say(uid,'Этот раздел доступен администратору Telefy.')
  return relevant
 s=max_grants.store();pending=s.input(uid)
 if not relevant and text.startswith('/'):
  if pending:s.clear(uid)
  return False
 if not relevant and(not pending or cb):return False
 if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'])
 if data=='maxgrant_beta':
  s.clear(uid);posts.store().cancel_input(uid);rem.store().cancel_upload(uid)
  enabled=not bool(s.mode()['beta']);token=s.mode_draft(uid,enabled)
  posts.say(uid,('Включить бета-режим? Max станет бесплатным для всех. Новые платежи будут отключены. Оплаченные подписки и история сохранятся.'if enabled else'Выключить бета-режим? Бесплатный общий Max закончится. Останутся действующие оплаченные и ручные периоды; для остальных вернутся бесплатные лимиты.')+'\nПриложения автоматически обновятся (обычно до 15 секунд).',[[posts.button('Включить бету'if enabled else'Выключить бету','maxgrant_mode_apply:'+token)],[posts.button('Отмена','maxgrant_mode_cancel:'+token)]]);return True
 if data.startswith(('maxgrant_mode_apply:','maxgrant_mode_cancel:')):
  import bot_operations
  bot_operations.store().ensure();cancel=data.startswith('maxgrant_mode_cancel:');ok=s.apply_mode(uid,data.split(':',1)[1],cancel)
  posts.say(uid,'Изменение отменено.'if ok and cancel else('✅ Бета-режим включён.'if s.mode()['beta']else'✅ Бета-режим выключен.')if ok else'Подтверждение истекло, использовано или режим уже изменился.');return True
 if data=='maxgrant_media':
  posts.store().cancel_input(uid);rem.store().cancel_upload(uid);s.input(uid,'payment_media');posts.say(uid,'Пришли картинку для сообщения после оплаты как фото.',[[posts.button('Отмена','maxgrant_cancel')]]);return True
 if data=='maxgrant_price':
  posts.store().cancel_input(uid);rem.store().cancel_upload(uid);s.input(uid,'price');posts.say(uid,'Текущая цена: '+max_grants.stars(s.price()['amount'])+' за 30 дней.\nВведи новую цену (целое число от 1 до 100000).',[[posts.button('Отмена','maxgrant_cancel')]]);return True
 if data.startswith(('maxgrant_price_apply:','maxgrant_price_drop:')):
  import bot_operations
  bot_operations.store().ensure();cancel=data.startswith('maxgrant_price_drop:');ok=s.apply_price(uid,data.split(':',1)[1],cancel)
  posts.say(uid,('Изменение отменено.'if cancel else'✅ Цена обновлена. Открытые приложения перезагрузятся при проверке обновлений (обычно до 15 секунд).')if ok else'Подтверждение истекло, использовано или цена уже изменена. Открой настройку заново.');return True
 if command=='/max_admin'or data=='maxgrant_start':
  posts.store().cancel_input(uid);rem.store().cancel_upload(uid);s.input(uid,'username')
  posts.say(uid,'🎟 Выдача Telefy Max\n\nОтправь Telegram @username пользователя, который уже открывал приложение.',[[posts.button('Отменить выдачу','maxgrant_cancel')]]);return True
 if data=='maxgrant_cancel':s.clear(uid);posts.say(uid,'Выдача отменена.');return True
 if data.startswith(('maxgrant_apply:','maxgrant_drop:')):
  cancel=data.startswith('maxgrant_drop:');result=s.apply(uid,data.split(':',1)[1],cancel)
  if not result:posts.say(uid,'Подтверждение уже использовано или истекло. Начни новую выдачу: /max_admin');return True
  if cancel:posts.say(uid,'Выдача отменена.');return True
  status=max_billing.STORE.status(result['telegram_id']);end=status.get('expires_at')
  posts.say(uid,'✅ Выдано '+str(result['days'])+' дней Telefy Max.\nTelegram ID: '+str(result['telegram_id'])+'\n'+('Доступ до '+date(end)if end else'Сейчас действует бесплатная бета. Выдача записана отдельно в БД.'));return True
 if not pending:return True
 if pending['phase']=='payment_media':
  photos=msg.get('photo')or[]
  if not photos:posts.say(uid,'Отправь изображение как фото через скрепку.');return True
  import max_notifications
  max_notifications.store().media(photos[-1]['file_id']);s.clear(uid);posts.say(uid,'✅ Картинка для сообщения после оплаты сохранена.');return True
 if pending['phase']=='price':
  if not text.isascii()or not text.isdigit()or not 1<=int(text)<=100000:posts.say(uid,'Введи целое число от 1 до 100000.');return True
  token=s.price_draft(uid,int(text));posts.say(uid,'Новая стоимость Max: '+max_grants.stars(int(text))+' за 30 дней.\nУже созданные счета сохранят свою цену. Открытые приложения будут перезагружены.',[[posts.button('✅ Изменить цену','maxgrant_price_apply:'+token)],[posts.button('Отмена','maxgrant_price_drop:'+token)]]);return True
 if pending['phase']=='username':
  if not re.fullmatch(r'@?[A-Za-z0-9_]{1,32}',text):posts.say(uid,'Отправь username в формате @username.');return True
  profile=s.profile(text)
  if not profile:posts.say(uid,'Профиль не найден или username неоднозначен. Пользователю нужно открыть Mini App; затем повтори ввод.');return True
  s.input(uid,'days',profile['telegram_id']);posts.say(uid,'Пользователь: '+profile['first_name']+' (@'+str(profile['username'])+')\nTelegram ID: '+str(profile['telegram_id'])+'\n\nСколько дней выдать? Введи целое число от 1 до 365.',[[posts.button('Отменить выдачу','maxgrant_cancel')]]);return True
 if pending['phase']=='days':
  if not text.isascii()or not text.isdigit()or not 1<=int(text)<=365:posts.say(uid,'Введи целое количество дней от 1 до 365.');return True
  profile=s.user(pending['target_id'])
  if not profile:s.clear(uid);posts.say(uid,'Профиль больше не найден.');return True
  days=int(text);status=max_billing.STORE.status(profile['telegram_id']);now=int(time.time());end=status.get('expires_at')or status.get('account_expires_at')or 0;new=max(now,end)+days*86400
  current='Бесплатная бета: Max доступен всем.'if status.get('beta')else('До окончания: '+str(max(0,math.ceil((end-now)/86400)))+' дн.\nТекущий срок: '+date(end)if end>now else'Подписка не активна.')
  token=s.draft(uid,profile['telegram_id'],days)
  posts.say(uid,'🎟 Подтверждение выдачи\n\n'+profile['first_name']+' (@'+str(profile['username'])+')\nTelegram ID: '+str(profile['telegram_id'])+'\n'+current+'\n\nДобавить: '+str(days)+' дн.\nНовый срок: '+date(new)+'\nОставшиеся оплаченные дни сохранятся.',[[posts.button('✅ Выдать подписку','maxgrant_apply:'+token)],[posts.button('Отменить выдачу','maxgrant_drop:'+token)]]);return True
 return True

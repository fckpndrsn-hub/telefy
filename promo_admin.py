"""Private Telegram admin wizard for issuing and retiring promotional codes."""
import time
from datetime import datetime,timezone,timedelta
import promo_codes
TZ=timezone(timedelta(hours=3))
def stamp(at):return datetime.fromtimestamp(at,TZ).strftime('%d.%m.%Y %H:%M МСК')
def caption(row):
 state='Удалён'if row['deleted_at']else'Истёк'if row['expires_at']<=time.time()else'Исчерпан'if row['used']>=row['max_uses']else'Активен'
 benefit='Скидка на Telefy Max: '+str(row['percent'])+'%'if row.get('kind')=='discount'else'Подарок: Telefy Max на '+str(row['days'])+' дн.'
 return row['code']+'\n\n'+benefit+'\nАктивирован: '+str(row['used'])+' из '+str(row['max_uses'])+'\nОсталось активаций: '+str(max(0,row['max_uses']-row['used']-row.get('pending',0)))+'\nДействует до: '+stamp(row['expires_at'])+'\nСтатус: '+state

def show_card(uid,identity):
 import bot_posts as p
 row,claims=promo_codes.store().card(identity)
 if not row:p.say(uid,'Промокод не найден.');return
 text=caption(row)
 if row.get('kind')=='discount':text+='\nОжидают подтверждения оплаты: '+str(row.get('pending',0))
 if claims:text+='\n\nПоследние активации:\n'+'\n'.join(('@'+r['username']if r['username']else str(r['telegram_id']))+' · '+stamp(r['claimed_at'])for r in claims)
 buttons=[[p.button('Обновить','promo_card:'+identity)]]
 if not row['deleted_at']:buttons.append([p.button('Удалить промокод','promo_remove:'+identity)])
 buttons.append([p.button('К промокодам','promo_list:0')]);p.say(uid,text,buttons)

def handle(update):
 import telefy_bot as bot,bot_reminders as rem,bot_posts as p,max_grants
 cb=update.get('callback_query')or{};msg=update.get('message')or{};user=cb.get('from')or msg.get('from')or{};chat=(cb.get('message')or msg).get('chat')or{}
 data=cb.get('data','');text=msg.get('text','').strip();command=text.split(' ',1)[0].split('@')[0];relevant=data.startswith('promo_')or command=='/promo_admin'
 if chat.get('type')!='private'or not bot.valid_user(user):return relevant
 uid=user['id']
 if uid not in rem.admins():
  if relevant:
   if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Только для администратора',show_alert=True)
   else:p.say(uid,'Этот раздел доступен администратору Telefy.')
  return relevant
 s=promo_codes.store();pending=s.input(uid)
 if not relevant:
  if cb or text.startswith('/'):
   if pending:s.cancel(uid)
   if pending and command=='/cancel':p.say(uid,'Выпуск промокода отменён.');return True
   return False
  if not pending:return False
 if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'])
 try:
  if data.startswith('promo_list')or command=='/promo_admin':
   s.cancel(uid);max_grants.store().clear(uid);p.store().cancel_input(uid);rem.store().cancel_upload(uid)
   page=int(data.split(':')[1])if ':'in data else 0;rows,more=s.codes(page)
   buttons=[[p.button('➕ Выпустить промокод','promo_new')]]
   for r in rows:buttons.append([p.button(r['code']+' · '+str(r['used'])+'/'+str(r['max_uses'])+' · '+('истёк'if r['expires_at']<=time.time()else str(r['percent'])+'%'if r['kind']=='discount'else str(r['days'])+' дн.'),'promo_card:'+r['id'])])
   nav=[]
   if page:nav.append(p.button('←','promo_list:'+str(page-1)))
   if more:nav.append(p.button('→','promo_list:'+str(page+1)))
   if nav:buttons.append(nav)
   buttons.append([p.button('В админку','post_menu')]);p.say(uid,'🎟 Выпуск промокодов\n\nВыбери код для статистики и удаления. Выданные по коду дни не считаются оплатой.',buttons);return True
  if data=='promo_new':
   max_grants.store().clear(uid);p.store().cancel_input(uid);rem.store().cancel_upload(uid)
   s.input(uid,'kind');p.say(uid,'Какой промокод выпустить?',[[p.button('🎁 Дни Telefy Max','promo_kind:gift')],[p.button('🏷 Скидка на подписку','promo_kind:discount')],[p.button('Отмена','promo_cancel')]]);return True
  if data in ('promo_kind:gift','promo_kind:discount'):
   if not pending or pending['stage']!='kind':p.say(uid,'Начни выпуск промокода заново.');return True
   kind=data.split(':')[1];s.input(uid,'percent'if kind=='discount'else'days',{'kind':kind,'days':30})
   p.say(uid,'Какой процент скидки? Введи целое число от 1 до 99. Цена рассчитывается от текущей стоимости Telefy Max, с округлением вверх до целой звезды (минимум 1). Скидки не складываются и не действуют на подарки.'if kind=='discount'else'Сколько дней Telefy Max дарит промокод?\nВведи число от 1 до 365.',[[p.button('Отмена','promo_cancel')]]);return True
  if data=='promo_cancel':s.cancel(uid);p.say(uid,'Выпуск промокода отменён.',[[p.button('К промокодам','promo_list:0')]]);return True
  if data.startswith('promo_card:'):show_card(uid,data.split(':',1)[1]);return True
  if data.startswith('promo_remove:'):
   identity=data.split(':',1)[1];row,_=s.card(identity)
   if not row:p.say(uid,'Промокод не найден.');return True
   p.say(uid,caption(row)+'\n\nУдалить этот код из списка и запретить новые активации? Уже выданные дни сохранятся.',[[p.button('Удалить','promo_delete:'+identity)],[p.button('Отмена','promo_card:'+identity)]]);return True
  if data.startswith('promo_delete:'):
   s.delete(data.split(':',1)[1]);p.say(uid,'Промокод удалён. Уже выданные дни сохранены.',[[p.button('К промокодам','promo_list:0')]]);return True
  if data=='promo_issue':
   row=s.issue(uid)
   if not row:p.say(uid,'Подтверждение истекло или уже использовано.');return True
   p.say(uid,'✅ Промокод выпущен\n\n'+caption(row)+'\n\nОдин пользователь может активировать код только один раз.',[[p.button('Статистика','promo_card:'+row['id'])],[p.button('К промокодам','promo_list:0')]]);return True
  if not pending:return True
  payload=pending['payload'];stage=pending['stage']
  if stage in ('days','percent'):
   maximum=99 if stage=='percent'else 365
   if not text.isascii()or not text.isdigit()or not 1<=int(text)<=maximum:p.say(uid,'Введи целое число от 1 до '+str(maximum)+'.');return True
   payload[stage]=int(text);s.input(uid,'expiry',payload);p.say(uid,'До какого момента можно активировать код?\n\nВведи количество дней от сегодня (1–3650) или точную дату по Москве: ДД.ММ.ГГГГ ЧЧ:ММ. Это срок активации кода, а не длительность подписки.');return True
  if stage=='expiry':
   try:
    if text.isascii()and text.isdigit()and 1<=int(text)<=3650:expiry=int(time.time())+int(text)*86400
    else:expiry=int(datetime.strptime(text,'%d.%m.%Y %H:%M').replace(tzinfo=TZ).timestamp())
    if expiry<=time.time():raise ValueError()
   except(ValueError,OverflowError):p.say(uid,'Нужна будущая дата ДД.ММ.ГГГГ ЧЧ:ММ или число дней 1–3650.');return True
   payload['expiry']=expiry;s.input(uid,'limit',payload);p.say(uid,'Сколько пользователей могут активировать код?\nВведи число от 1 до 1000000. Для одноразового кода — 1.');return True
  if stage=='limit':
   if not text.isascii()or not text.isdigit()or not 1<=int(text)<=1000000:p.say(uid,'Введи целое число от 1 до 1000000.');return True
   payload['limit']=int(text);s.input(uid,'confirm',payload);benefit='Скидка: '+str(payload['percent'])+'%'if payload.get('kind')=='discount'else'Telefy Max: '+str(payload['days'])+' дн.'
   p.say(uid,'Выпустить промокод?\n\n'+benefit+'\nАктивировать до: '+stamp(payload['expiry'])+'\nЛимит активаций: '+str(payload['limit'])+'\nНа пользователя: 1 активация.'+('\nАктивация засчитывается после оплаты. Подтверждённые Telegram оплаты резервируют места.'if payload.get('kind')=='discount'else''),[[p.button('Выпустить','promo_issue')],[p.button('Отмена','promo_cancel')]]);return True
  p.say(uid,'Подтверди выпуск кнопкой «Выпустить» или нажми «Отмена».');return True
 except promo_codes.PromoError:p.say(uid,'Параметры устарели или некорректны. Начни выпуск заново.');return True
 except Exception:p.say(uid,'Не удалось выполнить действие. Повтори позже.');return True

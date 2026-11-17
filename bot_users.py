"""Private admin user directory, transaction history, confirmed account actions."""
import time,secrets,math
import max_grants
from datetime import datetime,timezone,timedelta
PAGE=8
def date(value):return datetime.fromtimestamp(value,timezone(timedelta(hours=3))).strftime('%d.%m.%Y %H:%M МСК')if value else'—'
def table(db,c,name):
 if db.url:return bool(db.execute(c,'SELECT to_regclass(%s) AS name',(name,)).fetchone()['name'])
 return bool(db.execute(c,"SELECT 1 FROM sqlite_master WHERE type='table' AND name=%s",(name,)).fetchone())
class UserAdminStore:
 def __init__(self,grants):self.grants=grants;self.db=grants.db;self.ready=False
 def ensure(self):
  self.grants.ensure()
  if self.ready:return
  import max_billing
  engine=getattr(max_billing,'MaxStore',None)
  if engine is None:
   import stars_ledger
   engine=stars_ledger.MaxStore
  with max_grants.LOCK:
   if not getattr(self.db,'admin_payment_store',None):self.db.admin_payment_store=engine(self.db)
  self.db.admin_payment_store.ensure()
  with self.db.connect()as c:
   self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_admin_user_actions(id TEXT PRIMARY KEY,admin_id BIGINT NOT NULL,telegram_id BIGINT NOT NULL,profile_created_at BIGINT NOT NULL,operation TEXT NOT NULL,created_at BIGINT NOT NULL,state TEXT NOT NULL)')
   self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_admin_user_search(admin_id BIGINT PRIMARY KEY,query TEXT NOT NULL)')
  self.ready=True
 def search(self,admin,q=None):
  self.ensure()
  with self.db.connect()as c:
   if q is not None:self.db.execute(c,'INSERT INTO telefy_admin_user_search VALUES(%s,%s) ON CONFLICT(admin_id) DO UPDATE SET query=excluded.query',(admin,q[:64]));return q[:64]
   row=self.db.execute(c,'SELECT query FROM telefy_admin_user_search WHERE admin_id=%s',(admin,)).fetchone()
  return row['query']if row else''
 def users(self,q,page):
  q=q.lstrip('@').lower();pattern='%'+q+'%'
  where=' WHERE LOWER(COALESCE(username,\'\')) LIKE %s OR LOWER(first_name) LIKE %s OR CAST(telegram_id AS TEXT)=%s'
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT telegram_id,username,first_name FROM telefy_users'+where+' ORDER BY last_login_at DESC,telegram_id LIMIT %s OFFSET %s',(pattern,pattern,q,PAGE+1,page*PAGE)).fetchall()
  return [dict(r)for r in rows[:PAGE]],len(rows)>PAGE
 def draft(self,admin,uid,operation):
  self.ensure();user=self.grants.user(uid)
  if not user:return None
  token=secrets.token_hex(12)
  with self.db.connect()as c:self.db.execute(c,"INSERT INTO telefy_admin_user_actions VALUES(%s,%s,%s,%s,%s,%s,'draft')",(token,admin,uid,user['created_at'],operation,int(time.time())))
  return token
 def apply(self,admin,token,cancel=False):
  self.ensure();db=self.db
  with max_grants.LOCK,db.connect()as c:
   r=db.execute(c,'SELECT * FROM telefy_admin_user_actions WHERE id=%s AND admin_id=%s'+(' FOR UPDATE'if db.url else''),(token,admin)).fetchone()
   if not r or r['state']!='draft'or r['created_at']<int(time.time())-900:return None
   if cancel:db.execute(c,"UPDATE telefy_admin_user_actions SET state='cancelled' WHERE id=%s",(token,));return dict(r)
   user=db.execute(c,'SELECT created_at FROM telefy_users WHERE telegram_id=%s'+(' FOR UPDATE'if db.url else''),(r['telegram_id'],)).fetchone()
   if not user or user['created_at']!=r['profile_created_at']:return None
   uid=r['telegram_id'];now=int(time.time())
   if table(db,c,'telefy_star_orders'):
    db.execute(c,"INSERT INTO telefy_max_revoked_credits SELECT telegram_id,'payment',id,%s,%s FROM telefy_star_orders WHERE telegram_id=%s AND state='paid' ON CONFLICT(telegram_id,kind,credit_id) DO NOTHING",(admin,now,uid))
   if table(db,c,'telefy_max_gifts'):
    db.execute(c,"INSERT INTO telefy_max_revoked_credits SELECT recipient,'payment',order_id,%s,%s FROM telefy_max_gifts WHERE recipient=%s ON CONFLICT(telegram_id,kind,credit_id) DO NOTHING",(admin,now,uid))
   db.execute(c,"INSERT INTO telefy_max_revoked_credits SELECT telegram_id,'grant',id,%s,%s FROM telefy_max_grants WHERE telegram_id=%s ON CONFLICT(telegram_id,kind,credit_id) DO NOTHING",(admin,now,uid))
   if r['operation']=='delete':
    # Cascades remove sessions, taste and the personal library. Keep the
    # separate financial records and the admin audit trail.
    db.execute(c,'DELETE FROM telefy_users WHERE telegram_id=%s',(uid,))
    if table(db,c,'telefy_audio_exports'):db.execute(c,"UPDATE telefy_audio_exports SET status='failed',error='profile_deleted' WHERE telegram_id=%s AND status IN ('queued','preparing')",(uid,))
    if table(db,c,'telefy_reminder_contacts'):db.execute(c,'UPDATE telefy_reminder_contacts SET enabled=0 WHERE telegram_id=%s',(uid,))
   db.execute(c,"UPDATE telefy_admin_user_actions SET state='applied' WHERE id=%s",(token,))
   return dict(r)
 def payments(self,uid,page):
  self.ensure();db=self.db
  with db.connect()as c:
   if not table(db,c,'telefy_star_orders'):return [],False
   sql="SELECT o.id,o.telegram_id,o.state,o.amount,o.paid_at,COALESCE(o.payer_username,u.username) AS username FROM telefy_star_orders o LEFT JOIN telefy_users u ON u.telegram_id=o.telegram_id WHERE o.state IN ('paid','refunded')"
   params=[]
   if uid:sql+=' AND o.telegram_id=%s';params.append(uid)
   rows=db.execute(c,sql+' ORDER BY o.paid_at DESC,o.id DESC LIMIT %s OFFSET %s',tuple(params+[PAGE+1,page*PAGE])).fetchall()
  return [dict(r)for r in rows[:PAGE]],len(rows)>PAGE

def handle(update):
 import telefy_bot as bot,bot_reminders as rem,bot_posts as posts,max_billing
 cb=update.get('callback_query')or{};msg=update.get('message')or{};user=cb.get('from')or msg.get('from')or{};chat=(cb.get('message')or msg).get('chat')or{};data=cb.get('data','');text=msg.get('text','').strip()
 relevant=data.startswith('usr_')
 if not bot.valid_user(user)or chat.get('type')!='private':return relevant
 admin=user['id']
 if admin not in rem.admins():
  if relevant:bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Только для администратора',show_alert=True)
  return relevant
 g=max_grants.store();pending=g.input(admin)
 if not relevant and not(pending and pending['phase']=='user_search'and text and not text.startswith('/')):return False
 s=UserAdminStore(g);s.ensure();say=posts.say;button=posts.button
 if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'])
 try:
  parts=data.split(':');op=parts[0]
  if op=='usr_search':g.input(admin,'user_search');say(admin,'Отправь @username, Telegram ID или часть имени.');return True
  if not relevant:s.search(admin,text);g.clear(admin);op='usr_list';parts=[op,'0']
  if op=='usr_menu':
   s.search(admin,'');g.clear(admin);posts.store().cancel_input(admin);rem.store().cancel_upload(admin);op='usr_list';parts=[op,'0']
  if op=='usr_list':
   page=max(0,min(100000,int(parts[1])));rows,more=s.users(s.search(admin),page)
   buttons=[[button((('@'+r['username'])if r['username']else r['first_name'])+' · '+str(r['telegram_id']),'usr_card:'+str(r['telegram_id']))]for r in rows]
   nav=[]
   if page:nav.append(button('←','usr_list:'+str(page-1)))
   if more:nav.append(button('→','usr_list:'+str(page+1)))
   if nav:buttons.append(nav)
   buttons+=[[button('🔎 Найти пользователя','usr_search')],[button('Назад','post_menu')]];say(admin,'👥 Пользователи · страница '+str(page+1)+('\nПоиск: '+s.search(admin)if s.search(admin)else'')+(''if rows else'\nПользователей не найдено.'),buttons);return True
  if op in('usr_card','usr_grant','usr_revoke','usr_delete'):
   uid=int(parts[1]);profile=g.user(uid)
   if not profile:say(admin,'Профиль не найден.');return True
   identity=profile['first_name']+' (@'+str(profile['username']or'без username')+')\nTelegram ID: '+str(uid)
   status=max_billing.STORE.status(uid);end=status.get('expires_at')
   if op=='usr_grant':g.input(admin,'days',uid);say(admin,identity+'\n\nСколько дней Max выдать? От 1 до 365.',[[button('Отмена','maxgrant_cancel')]]);return True
   if op=='usr_card':
    caption='Бесплатная бета'if status.get('beta')else('Max до '+date(end)+'\nОсталось дней: '+str(max(0,math.ceil((end-time.time())/86400)))if status['active']else'Max не активен')
    say(admin,identity+'\n\n'+caption+'\nЗарегистрирован: '+date(profile['created_at'])+'\nПоследний вход: '+date(profile['last_login_at']),[[button('🎟 Выдать Max','usr_grant:'+str(uid))],[button('Снять Max','usr_revoke:'+str(uid))],[button('⭐ Платежи','usr_history:'+str(uid)+':0')],[button('Удалить профиль','usr_delete:'+str(uid))],[button('К списку','usr_list:0')]]);return True
   operation='delete'if op=='usr_delete'else'revoke';token=s.draft(admin,uid,operation)
   body='Удалить профиль, его библиотеку и сеансы входа?'if operation=='delete'else'Снять все текущие оплаченные и выданные вручную периоды Max?'
   say(admin,identity+'\n\n'+body+'\nИстория платежей сохранится. Возврат звёзд не выполняется.'+('\nВ бесплатной бете общий бесплатный доступ сохраняется.'if status.get('beta')else''),[[button('Подтвердить','usr_apply:'+token)],[button('Отмена','usr_cancel:'+token)]]);return True
  if op in('usr_apply','usr_cancel'):
   result=s.apply(admin,parts[1],op=='usr_cancel');say(admin,'Подтверждение истекло или уже использовано.'if not result else'Действие отменено.'if op=='usr_cancel'else'✅ Профиль удалён.'if result['operation']=='delete'else'✅ Текущие периоды Max сняты.');return True
  if op in('usr_payments','usr_history'):
   uid=int(parts[1])if op=='usr_history'else 0;page=max(0,min(100000,int(parts[2]if uid else parts[1])));rows,more=s.payments(uid,page)
   blocks=['⭐ История платежей · страница '+str(page+1)]
   for r in rows:blocks.append(('@'+r['username']if r['username']else'Telegram ID '+str(r['telegram_id']))+'\n'+max_grants.stars(r['amount'])+' · '+date(r['paid_at'])+('\nПодарок Telefy Max · 30 дней\nСтатус: 'if __import__('max_gifts').by_order(__import__('max_billing').STORE,r['id'])else'\nTelefy Max · 30 дней\nСтатус: ')+('Возвращён'if r['state']=='refunded'else'Оплачен')+'\nЗаказ: '+r['id'])
   prefix='usr_history:'+str(uid)+':'if uid else'usr_payments:';nav=[]
   if page:nav.append(button('←',prefix+str(page-1)))
   if more:nav.append(button('→',prefix+str(page+1)))
   buttons=([nav]if nav else[])+[[button('Назад','usr_card:'+str(uid)if uid else'post_menu')]];say(admin,'\n\n'.join(blocks)+(''if rows else'\n\nПлатежей пока нет.'),buttons);return True
 except (ValueError,IndexError):say(admin,'Не удалось открыть действие. Вернись в /admin.');return True
 return True

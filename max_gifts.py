"""Single-use paid gifts; recipient entitlement follows the original payment/refund."""
import secrets,time,json,re
from urllib.parse import urlsplit,parse_qs

def ensure(store):
 with store.db.connect()as c:
  store.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_max_gifts(order_id TEXT PRIMARY KEY,token TEXT UNIQUE NOT NULL,message TEXT NOT NULL,recipient BIGINT,claimed_at BIGINT)')
  store.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_gift_media(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,file_id TEXT NOT NULL)')
  store.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_gift_media_drafts(token TEXT PRIMARY KEY,admin_id BIGINT NOT NULL,kind TEXT NOT NULL,file_id TEXT NOT NULL,expires_at BIGINT NOT NULL)')

def create(store,c,oid,message):
 store.db.execute(c,'INSERT INTO telefy_max_gifts(order_id,token,message) VALUES(%s,%s,%s)',(oid,secrets.token_urlsafe(32),str(message or '')[:300]))

def by_order(store,oid):
 ensure(store)
 with store.db.connect()as c:r=store.db.execute(c,'SELECT * FROM telefy_max_gifts WHERE order_id=%s',(oid,)).fetchone()
 return dict(r)if r else None

def info(store,token,uid,claim=False):
 from max_billing import BillingError
 if not re.fullmatch(r'[A-Za-z0-9_-]{40,48}',str(token)):raise BillingError(404,'gift_not_found')
 ensure(store)
 with store.lock,store.db.connect()as c:
  r=store.db.execute(c,'SELECT g.*,o.state,o.telegram_id FROM telefy_max_gifts g JOIN telefy_star_orders o ON o.id=g.order_id WHERE g.token=%s'+(' FOR UPDATE'if store.db.url else''),(token,)).fetchone()
  if not r or r['state']!='paid':raise BillingError(404,'gift_not_available')
  if claim:
   if r['telegram_id']==uid:raise BillingError(409,'gift_for_someone_else')
   if r['recipient']not in(None,uid):raise BillingError(409,'gift_already_claimed')
   if r['recipient']is None:store.db.execute(c,'UPDATE telefy_max_gifts SET recipient=%s,claimed_at=%s WHERE token=%s AND recipient IS NULL',(uid,int(time.time()),token))
  return {'message':r['message'],'days':30,'claimed':bool(r['recipient'])or claim,'mine':r['recipient']==uid or claim}

def events(store,c,uid):
 return store.db.execute(c,"SELECT o.id,g.claimed_at AS paid_at FROM telefy_max_gifts g JOIN telefy_star_orders o ON o.id=g.order_id WHERE g.recipient=%s AND o.state='paid' ORDER BY g.claimed_at,o.id",(uid,)).fetchall()

def route(handler,path):
 from max_billing import STORE,BillingError
 if path not in('/api/max/gifts/invoice','/api/max/gifts/claim','/api/max/gifts/info','/api/max/gifts/order','/api/max/gifts/share'):return False
 try:
  STORE.ensure();user=handler.max_user()
  if not user:raise BillingError(401,'login_required')
  if handler.command=='POST':
   if not handler.same_origin():raise BillingError(403,'origin_rejected')
   n=int(handler.headers.get('Content-Length','0'))
   if not 0<n<=4096:raise BillingError(400,'invalid_request')
   body=json.loads(handler.rfile.read(n))
  else:body={k:v[0]for k,v in parse_qs(urlsplit(handler.path).query).items()}
  uid=user['telegram_id']
  if path.endswith('/invoice'):
   if handler.command!='POST':raise BillingError(405,'method_not_allowed')
   result=STORE.invoice(uid,body.get('request_key'),body.get('terms_accepted'),body.get('expected_amount'),gift_message=body.get('message',''),gift=True)
  elif path.endswith('/share'):
   if handler.command!='POST':raise BillingError(405,'method_not_allowed')
   result=prepare_share(STORE,body.get('id'),uid)
  elif path.endswith('/order'):
   order=STORE.order(body.get('id'));g=by_order(STORE,body.get('id'))
   if not order or order['telegram_id']!=uid or not g:raise BillingError(404,'gift_not_found')
   import telefy_bot
   result={'status':order['state'],'url':'https://t.me/'+telefy_bot.BOT_USERNAME+'?startapp=gift_'+g['token'] if order['state']=='paid'else None}
  else:
   claim=path.endswith('/claim')
   if claim and handler.command!='POST':raise BillingError(405,'method_not_allowed')
   result=info(STORE,body.get('token'),uid,claim)
  handler.reply(200,result)
 except BillingError as e:handler.reply(e.status,{'error':e.code})
 except Exception:handler.reply(503,{'error':'gift_unavailable'})
 return True

def admin(update):
 import telefy_bot as bot,bot_reminders as rem,bot_posts as posts,max_grants,max_billing
 cb=update.get('callback_query')or{};msg=update.get('message')or{};user=cb.get('from')or msg.get('from')or{};chat=(cb.get('message')or msg).get('chat')or{}
 if chat.get('type')!='private'or user.get('id')not in rem.admins():return False
 uid=user['id'];s=max_grants.store();pending=s.input(uid);data=cb.get('data','')
 if data.startswith(('gift_save:','gift_cancel:')):
  bot.api('answerCallbackQuery',callback_query_id=cb['id']);ensure(max_billing.STORE)
  with max_billing.STORE.db.connect()as c:
   row=max_billing.STORE.db.execute(c,'SELECT * FROM telefy_gift_media_drafts WHERE token=%s AND admin_id=%s AND expires_at>%s',(data.split(':',1)[1],uid,int(time.time()))).fetchone()
   if not row:posts.say(uid,'Предпросмотр устарел. Загрузи медиа заново.');return True
   if data.startswith('gift_save:'):max_billing.STORE.db.execute(c,'INSERT INTO telefy_gift_media VALUES(1,%s,%s) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,file_id=excluded.file_id',(row['kind'],row['file_id']))
   max_billing.STORE.db.execute(c,'DELETE FROM telefy_gift_media_drafts WHERE token=%s',(row['token'],))
  s.clear(uid);posts.say(uid,'✅ Медиа подарка сохранено.'if data.startswith('gift_save:')else'Изменение отменено.');return True
 if data=='gift_settings':
  bot.api('answerCallbackQuery',callback_query_id=cb['id']);s.clear(uid);posts.say(uid,'Подарок Telefy Max',[[posts.button('Медиа','gift_media'),posts.button('Текст и эмоджи','gift_text')],[posts.button('Предпросмотр','gift_preview')]]);return True
 if data=='gift_preview_hint':
  bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Это предпросмотр. Настоящий подарок отправляется после покупки.');return True
 if data=='gift_preview':
  bot.api('answerCallbackQuery',callback_query_id=cb['id']);preview(uid);return True
 if data=='gift_text':
  bot.api('answerCallbackQuery',callback_query_id=cb['id']);s.input(uid,'gift_text');posts.say(uid,'Отправь текст подарка с форматированием и premium-эмоджи (до 1024 символов). /cancel — отмена.');return True
 if pending and pending['phase']=='gift_text' and msg and not msg.get('text','').startswith('/'):
  body=msg.get('text')or msg.get('caption')or'';entities=msg.get('entities')or msg.get('caption_entities')or[]
  try:posts.store().set_text('gift',body,entities)
  except ValueError:posts.say(uid,'Нужен текст до 1024 символов.');return True
  s.clear(uid);preview(uid);posts.say(uid,'Текст, форматирование и premium-эмоджи подарка сохранены ✅');return True
 if data=='gift_media':
  bot.api('answerCallbackQuery',callback_query_id=cb['id']);s.input(uid,'gift_media');posts.say(uid,'Пришли фото, видео или GIF для сообщения с подарком. Бот покажет предпросмотр перед сохранением. /cancel — отменить.');return True
 if not pending or pending['phase']!='gift_media':return False
 if msg.get('text','').startswith('/'):
  s.clear(uid);return False
 media=msg.get('animation')or msg.get('video')or(msg.get('photo')or[{}])[-1];kind=('mpeg4'if media.get('mime_type')=='video/mp4'else'animation')if msg.get('animation')else'video'if msg.get('video')else'photo'
 if not media.get('file_id'):posts.say(uid,'Нужно фото, видео или GIF.');return True
 ensure(max_billing.STORE)
 # Preview precedes persistence; a failed preview does not alter the saved media.
 template=posts.store().template('gift')or{'body':'🎁 У меня для тебя подарок! Нажми на кнопку ниже, чтобы получить Telefy Max.','entities':[]}
 bot.api({'photo':'sendPhoto','video':'sendVideo','animation':'sendAnimation','mpeg4':'sendAnimation'}[kind],chat_id=uid,**{('animation'if kind=='mpeg4'else kind):media['file_id']},caption=template['body'],caption_entities=template['entities'])
 token=secrets.token_hex(12)
 with max_billing.STORE.db.connect()as c:max_billing.STORE.db.execute(c,'INSERT INTO telefy_gift_media_drafts VALUES(%s,%s,%s,%s,%s)',(token,uid,kind,media['file_id'],int(time.time())+900))
 posts.say(uid,'Предпросмотр выше. Сохранить это медиа для сообщений с подарками?',[[posts.button('Сохранить','gift_save:'+token),posts.button('Отмена','gift_cancel:'+token)]]);return True

def gift_content(store):
 import bot_posts
 ensure(store)
 with store.db.connect()as c:media=store.db.execute(c,'SELECT * FROM telefy_gift_media WHERE id=1').fetchone()
 template=bot_posts.store().template('gift')or{'body':'🎁 У меня для тебя подарок! Нажми на кнопку ниже, чтобы получить Telefy Max.','entities':[]}
 return dict(media)if media else None,template

def preview(uid):
 import telefy_bot as bot,max_billing
 media,text=gift_content(max_billing.STORE)
 args={'chat_id':uid,'reply_markup':{'inline_keyboard':[[{'text':'Получить подарок','callback_data':'gift_preview_hint'}]]}}
 if media:bot.api({'photo':'sendPhoto','video':'sendVideo','animation':'sendAnimation','mpeg4':'sendAnimation'}[media['kind']],**args,**{('animation'if media['kind']=='mpeg4'else media['kind']):media['file_id']},caption=text['body'],caption_entities=text['entities'])
 else:bot.api('sendMessage',**args,text=text['body'],entities=text['entities'])

def prepare_share(store,oid,uid):
 from max_billing import BillingError
 import telefy_bot as bot
 order=store.order(oid);gift=by_order(store,oid)
 if not order or order['telegram_id']!=uid or not gift:raise BillingError(404,'gift_not_found')
 if order['state']!='paid' or gift['recipient'] is not None:raise BillingError(409,'gift_not_available')
 media,text=gift_content(store)
 result={'id':secrets.token_hex(12),'reply_markup':{'inline_keyboard':[[{'text':'Получить подарок','url':'https://t.me/'+bot.BOT_USERNAME+'?startapp=gift_'+gift['token']}]]}}
 if media:
  kind={'photo':'photo','video':'video','animation':'gif','mpeg4':'mpeg4_gif'}[media['kind']]
  result.update(type=kind,caption=text['body'],caption_entities=text['entities'],**{('mpeg4_file_id'if kind=='mpeg4_gif'else kind+'_file_id'):media['file_id']})
  if kind=='video':result['title']='Подарок Telefy Max'
 else:result.update(type='article',title='Подарок Telefy Max',input_message_content={'message_text':text['body'],'entities':text['entities']})
 prepared=bot.api('savePreparedInlineMessage',user_id=uid,result=result,allow_user_chats=True,allow_bot_chats=False,allow_group_chats=False,allow_channel_chats=False)
 return {'id':prepared['id'],'expires_at':prepared.get('expiration_date')}

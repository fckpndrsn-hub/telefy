"""Private admin editor and durable, explicitly confirmed bot campaigns."""
import json,time,secrets,threading

LOCK=threading.Lock()

def store():
 import bot_reminders as rem
 root=rem.store();root.ensure();db=root.db
 with LOCK:
  if not getattr(db,'posts_store',None):db.posts_store=PostStore(db)
  result=db.posts_store
 result.ensure();return result

def text_size(text):return len(text.encode('utf-16-le'))//2

def rich_entities(body,entities):
 if not isinstance(entities,list)or len(entities)>100:raise ValueError('entities')
 size=text_size(body);result=[]
 for entity in entities:
  if not isinstance(entity,dict):raise ValueError('entity')
  entity=dict(entity);start=entity.get('offset');length=entity.get('length')
  if type(start)is not int or type(length)is not int or start<0 or length<=0 or start+length>size:raise ValueError('entity_range')
  # Entity boundaries cannot cut a supplementary Unicode character in half.
  raw=body.encode('utf-16-le')
  try:raw[:start*2].decode('utf-16-le');raw[:(start+length)*2].decode('utf-16-le')
  except UnicodeDecodeError:raise ValueError('entity_boundary')from None
  result.append(entity)
 return result

def personalize(body,entities,name):
 import re
 entities=rich_entities(body,entities)
 # Telegram offsets are UTF-16 code units, not Python character indices.
 for match in reversed(list(re.finditer(r'\{name\}',body))):
  start=text_size(body[:match.start()]);end=start+6;delta=text_size(name)-6;updated=[]
  for original in entities:
   entity=dict(original);a=entity['offset'];b=a+entity['length']
   if b<=start:pass
   elif a>=end:entity['offset']+=delta
   elif a<=start and b>=end:entity['length']+=delta
   else:continue
   updated.append(entity)
  entities=updated;body=body[:match.start()]+name+body[match.end():]
 return {'body':body,'entities':rich_entities(body,entities)}

class PostStore:
 def __init__(self,db):self.db=db;self.ready=False;self.lock=threading.Lock()
 def ensure(self):
  self.db.ensure()
  with self.lock:
   if self.ready:return
   with self.db.connect()as c:
    if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620114)')
    for sql in [
     'CREATE TABLE IF NOT EXISTS telefy_bot_texts (stage TEXT PRIMARY KEY,body TEXT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_bot_text_entities (stage TEXT PRIMARY KEY,entities TEXT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_bot_buttons (key TEXT PRIMARY KEY,config TEXT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_post_control (id INTEGER PRIMARY KEY,retry_at BIGINT NOT NULL)',
     'CREATE TABLE IF NOT EXISTS telefy_post_inputs (admin_id BIGINT PRIMARY KEY,kind TEXT NOT NULL,target TEXT NOT NULL,expires_at BIGINT NOT NULL)',
     '''CREATE TABLE IF NOT EXISTS telefy_bot_posts (id TEXT PRIMARY KEY,admin_id BIGINT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,created_at BIGINT NOT NULL)''',
     '''CREATE TABLE IF NOT EXISTS telefy_post_deliveries (post_id TEXT NOT NULL REFERENCES telefy_bot_posts(id) ON DELETE CASCADE,telegram_id BIGINT NOT NULL,status TEXT NOT NULL,retry_at BIGINT NOT NULL,PRIMARY KEY(post_id,telegram_id))''',
     'CREATE INDEX IF NOT EXISTS telefy_post_pending_idx ON telefy_post_deliveries(status,retry_at)']:
     self.db.execute(c,sql)
   self.ready=True
 def text(self,stage):
  with self.db.connect()as c:row=self.db.execute(c,'SELECT body FROM telefy_bot_texts WHERE stage=%s',(stage,)).fetchone()
  return row['body']if row else None
 def template(self,stage):
  with self.db.connect()as c:
   row=self.db.execute(c,'SELECT body FROM telefy_bot_texts WHERE stage=%s',(stage,)).fetchone()
   if not row:return None
   extra=self.db.execute(c,'SELECT entities FROM telefy_bot_text_entities WHERE stage=%s',(stage,)).fetchone()
  return {'body':row['body'],'entities':json.loads(extra['entities'])if extra else []}
 def button(self,key,config=None,reset=False):
  with self.db.connect()as c:
   if reset:self.db.execute(c,'DELETE FROM telefy_bot_buttons WHERE key=%s',(key,));return
   if config is not None:self.db.execute(c,'INSERT INTO telefy_bot_buttons VALUES(%s,%s) ON CONFLICT(key) DO UPDATE SET config=excluded.config',(key,json.dumps(config,ensure_ascii=False)));return
   row=self.db.execute(c,'SELECT config FROM telefy_bot_buttons WHERE key=%s',(key,)).fetchone()
  return json.loads(row['config'])if row else {}
 def set_text(self,stage,body,entities=None):
  from reminder_store import MEDIA_STAGES
  if stage not in (*MEDIA_STAGES,'gift') or not isinstance(body,str)or not body.strip()or text_size(body)>1024:raise ValueError('text_limit')
  entities=rich_entities(body,entities or [])
  with self.db.connect()as c:
   self.db.execute(c,'INSERT INTO telefy_bot_texts VALUES(%s,%s) ON CONFLICT(stage) DO UPDATE SET body=excluded.body',(stage,body))
   self.db.execute(c,'INSERT INTO telefy_bot_text_entities VALUES(%s,%s) ON CONFLICT(stage) DO UPDATE SET entities=excluded.entities',(stage,json.dumps(entities,ensure_ascii=False)))
 def reset_text(self,stage):
  with self.db.connect()as c:
   self.db.execute(c,'DELETE FROM telefy_bot_texts WHERE stage=%s',(stage,))
   self.db.execute(c,'DELETE FROM telefy_bot_text_entities WHERE stage=%s',(stage,))
 def input(self,uid,kind=None,target=''):
  with self.db.connect()as c:
   if kind:
    self.db.execute(c,'INSERT INTO telefy_post_inputs VALUES(%s,%s,%s,%s) ON CONFLICT(admin_id) DO UPDATE SET kind=excluded.kind,target=excluded.target,expires_at=excluded.expires_at',(uid,kind,target,int(time.time())+1800));return
   row=self.db.execute(c,'SELECT * FROM telefy_post_inputs WHERE admin_id=%s AND expires_at>%s',(uid,int(time.time()))).fetchone()
  return dict(row)if row else None
 def cancel_input(self,uid):
  with self.db.connect()as c:self.db.execute(c,'DELETE FROM telefy_post_inputs WHERE admin_id=%s',(uid,))
 def create(self,uid,payload):
  pid=secrets.token_hex(8)
  with self.db.connect()as c:self.db.execute(c,'INSERT INTO telefy_bot_posts VALUES(%s,%s,%s,%s,%s)',(pid,uid,json.dumps(payload,ensure_ascii=False),'draft',int(time.time())))
  return pid
 def post(self,uid,pid):
  with self.db.connect()as c:row=self.db.execute(c,'SELECT * FROM telefy_bot_posts WHERE id=%s AND admin_id=%s',(pid,uid)).fetchone()
  if not row:return None
  p=dict(row);p['payload']=json.loads(p['payload']);return p
 def recent(self,uid):
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT id,status FROM telefy_bot_posts WHERE admin_id=%s ORDER BY created_at DESC,id DESC LIMIT 10',(uid,)).fetchall()
  return [dict(r)for r in rows]
 def edit(self,uid,pid,payload):
  with self.db.connect()as c:return self.db.execute(c,"UPDATE telefy_bot_posts SET payload=%s WHERE id=%s AND admin_id=%s AND status='draft'",(json.dumps(payload,ensure_ascii=False),pid,uid)).rowcount==1
 def recipients(self):
  with self.db.connect()as c:row=self.db.execute(c,'SELECT COUNT(*) AS n FROM telefy_reminder_contacts WHERE chat_started=1 AND enabled=1 AND reachable=1').fetchone()
  return row['n']
 def confirm(self,uid,pid):
  # Payload is immutable once queued; a repeated confirmation cannot send twice.
  with self.db.connect()as c:
   changed=self.db.execute(c,"UPDATE telefy_bot_posts SET status='queued' WHERE id=%s AND admin_id=%s AND status='review'",(pid,uid))
   if changed.rowcount!=1:return False
   inserted=self.db.execute(c,"INSERT INTO telefy_post_deliveries SELECT %s,telegram_id,'pending',0 FROM telefy_reminder_contacts WHERE chat_started=1 AND enabled=1 AND reachable=1",(pid,))
   if inserted.rowcount==0:self.db.execute(c,"UPDATE telefy_bot_posts SET status='completed' WHERE id=%s",(pid,))
  return True
 def review(self,uid,pid,back=False):
  with self.db.connect()as c:return self.db.execute(c,'UPDATE telefy_bot_posts SET status=%s WHERE id=%s AND admin_id=%s AND status=%s',('draft'if back else'review',pid,uid,'review'if back else'draft')).rowcount==1
 def cancel(self,uid,pid):
  with self.db.connect()as c:
   self.db.execute(c,"UPDATE telefy_bot_posts SET status='cancelled' WHERE id=%s AND admin_id=%s AND status IN ('draft','review','queued')",(pid,uid))
  # Commit the parent state before touching recipient rows: a sender finishes
  # child-first, so holding both here would invert PostgreSQL lock order.
  with self.db.connect()as c:
   self.db.execute(c,"UPDATE telefy_post_deliveries SET status='cancelled' WHERE post_id=%s AND status='pending' AND EXISTS(SELECT 1 FROM telefy_bot_posts WHERE id=%s AND admin_id=%s)",(pid,pid,uid))
 def claim(self,now):
  with self.db.connect()as c:
   pause=self.db.execute(c,'SELECT retry_at FROM telefy_post_control WHERE id=1').fetchone()
   if pause and pause['retry_at']>now:return None
   row=self.db.execute(c,"SELECT d.post_id,d.telegram_id,p.payload FROM telefy_post_deliveries d JOIN telefy_bot_posts p ON p.id=d.post_id WHERE d.status='pending' AND d.retry_at<=%s AND p.status='queued' ORDER BY p.created_at,d.telegram_id LIMIT 1"+(' FOR UPDATE OF d SKIP LOCKED'if self.db.url else ''),(now,)).fetchone()
   if not row:return None
   job=dict(row)
   changed=self.db.execute(c,"UPDATE telefy_post_deliveries SET status='reserved' WHERE post_id=%s AND telegram_id=%s AND status='pending'",(job['post_id'],job['telegram_id']))
   if changed.rowcount!=1:return None
  job['payload']=json.loads(job['payload']);return job
 def eligible(self,job):
  with self.db.connect()as c:row=self.db.execute(c,"SELECT 1 FROM telefy_reminder_contacts r JOIN telefy_bot_posts p ON p.id=%s WHERE r.telegram_id=%s AND r.enabled=1 AND r.reachable=1 AND r.chat_started=1 AND p.status='queued'",(job['post_id'],job['telegram_id'])).fetchone()
  return bool(row)
 def finish(self,job,status,retry=0,pause=False):
  with self.db.connect()as c:
   self.db.execute(c,'UPDATE telefy_post_deliveries SET status=%s,retry_at=%s WHERE post_id=%s AND telegram_id=%s',(status,int(time.time())+retry,job['post_id'],job['telegram_id']))
   if pause:self.db.execute(c,'INSERT INTO telefy_post_control VALUES(1,%s) ON CONFLICT(id) DO UPDATE SET retry_at=excluded.retry_at',(int(time.time())+retry,))
   self.db.execute(c,"UPDATE telefy_bot_posts SET status='completed' WHERE id=%s AND status='queued' AND NOT EXISTS(SELECT 1 FROM telefy_post_deliveries WHERE post_id=%s AND status IN ('pending','reserved'))",(job['post_id'],job['post_id']))
 def stats(self,uid,pid):
  if not self.post(uid,pid):return None
  with self.db.connect()as c:rows=self.db.execute(c,'SELECT status,COUNT(*) AS n FROM telefy_post_deliveries WHERE post_id=%s GROUP BY status',(pid,)).fetchall()
  return {r['status']:r['n']for r in rows}

def extract(message):
 body=message.get('text',message.get('caption',''))
 entities=message.get('entities',message.get('caption_entities',[]))
 media=None
 for kind in ('photo','animation','video','audio','document'):
  value=message.get(kind)
  if kind=='photo'and isinstance(value,list)and value:value=value[-1]
  if isinstance(value,dict)and value.get('file_id'):media={'kind':kind,'file_id':value['file_id']};break
 if not isinstance(body,str)or (not body.strip()and not media)or text_size(body)>(1024 if media else 4096):raise ValueError('post_limit')
 return {'body':body,'entities':rich_entities(body,entities),'media':media}

def deliver(uid,payload):
 import telefy_bot as bot
 import bot_buttons
 markup={'inline_keyboard':[[bot_buttons.make('open',web_app={'url':bot.BASE+'/telefy.html'})],[bot_buttons.make('optout',callback_data='reminders_off')]]}
 common={'chat_id':uid,'reply_markup':markup};media=payload['media']
 if media:
  method={'photo':'sendPhoto','video':'sendVideo','animation':'sendAnimation','audio':'sendAudio','document':'sendDocument'}[media['kind']]
  bot.api(method,**common,**{media['kind']:media['file_id']},caption=payload['body'],caption_entities=payload['entities'])
 else:bot.api('sendMessage',**common,text=payload['body'],entities=payload['entities'])

def run_one():
 import telefy_bot as bot,bot_reminders as rem
 import bot_operations
 if bot_operations.store().status()['maintenance']:return False
 s=store();job=s.claim(int(time.time()))
 if not job:return False
 try:
  if not s.eligible(job)or not bot.subscribed(job['telegram_id']):s.finish(job,'skipped');return True
 except Exception:s.finish(job,'pending',300);return True
 # A restart during this network call leaves a reserved job; never blindly resend.
 try:deliver(job['telegram_id'],job['payload']);s.finish(job,'sent')
 except bot.BotError as error:
  if error.definitive and error.status==429:s.finish(job,'pending',error.retry_after,pause=True)
  elif error.definitive and error.status==403:rem.store().reachable(job['telegram_id'],False);s.finish(job,'blocked')
  elif error.definitive:s.finish(job,'failed')
  else:s.finish(job,'uncertain')
 except Exception:s.finish(job,'uncertain')
 return True

def say(uid,text,rows=None):
 import telefy_bot as bot
 args={'reply_markup':{'inline_keyboard':rows}}if rows else {}
 bot.api('sendMessage',chat_id=uid,text=text,**args)

def button(text,data):return {'text':text,'callback_data':data}

def panel(uid):
 say(uid,'Управление Telefy',[[button('🟢 Сейчас в Telefy','analytics_live')],[button('📈 Аналитика и CSV','analytics_menu')],[button('🎁 Подарок: текст и медиа','gift_settings')],[button('🎟 Выпуск промокодов','promo_list:0')],[button('🧪 Режим бета: '+('ВКЛ'if __import__('max_grants').store().mode()['beta']else'ВЫКЛ'),'maxgrant_beta')],[button('👥 Пользователи','usr_menu')],[button('⭐ История платежей','usr_payments:0')],[button('🎟 Выдать Telefy Max','maxgrant_start')],[button('⭐ Стоимость Max','maxgrant_price')],[button('🖼 Картинка после оплаты','maxgrant_media')],[button('📊 Сводка пользователей','ops_stats')],[button('🛠 Управление Mini App','ops_menu')],[button('📣 Новый пост','post_new')],[button('🗂 Мои посты','post_list')],[button('✏️ Приветствие и напоминания','post_templates')],[button('🎛 Кнопки бота','btn_menu')]])

def draft(uid,pid):
 p=store().post(uid,pid)
 if not p:return say(uid,'Черновик не найден.')
 if p['status']!='draft':return status(uid,pid)
 say(uid,'Черновик сохранён. Пока его видишь только ты.',[
  [button('👁 Предпросмотр','post_preview:'+pid)],
  [button('✏️ Изменить текст','post_text:'+pid),button('📎 Добавить медиа','post_media:'+pid)],
  [button('Убрать медиа','post_clear:'+pid)],
  [button('📣 Перейти к отправке','post_prepare:'+pid),button('Отменить','post_cancel:'+pid)]])

def status(uid,pid):
 s=store();p=s.post(uid,pid)
 if not p:return say(uid,'Пост не найден.')
 counts=s.stats(uid,pid);labels={'pending':'В очереди','reserved':'Начата отправка, результат не подтверждён','sent':'Доставлено','skipped':'Пропущено','blocked':'Бот заблокирован','failed':'Ошибка','uncertain':'Результат неизвестен','cancelled':'Отменено'}
 text='Статус поста: '+p['status']+'\n'+'\n'.join(labels.get(k,k)+': '+str(v)for k,v in counts.items())
 if p['status']=='review':rows=[[button('Посмотреть и подтвердить','post_review:'+pid),button('К черновику','post_back:'+pid)]]
 else:rows=[[button('Обновить','post_status:'+pid),button('Остановить очередь','post_cancel:'+pid)]]
 say(uid,text,rows)

def review_panel(uid,pid):
 s=store();p=s.post(uid,pid)
 if not p or p['status']!='review':return
 deliver(uid,p['payload']);say(uid,'Отправить этот пост пользователям бота?\nПолучателей до проверки подписки: '+str(s.recipients())+'\nОтказавшиеся от сообщений и заблокировавшие бота исключены.',[[button('✅ Подтвердить рассылку','post_confirm:'+pid)],[button('Вернуться к черновику','post_back:'+pid)]])

def handle(update):
 import telefy_bot as bot,bot_reminders as rem
 import bot_operations
 if bot_operations.handle(update):return True
 import bot_buttons
 if bot_buttons.handle(update):return True
 cb=update.get('callback_query')or{};msg=update.get('message')or{};user=cb.get('from')or msg.get('from')or{}
 chat=(cb.get('message')or msg).get('chat')or{}
 if not bot.valid_user(user)or chat.get('type')!='private':return False
 uid=user['id'];data=cb.get('data','');command=msg.get('text','').split(' ',1)[0].split('@')[0]
 relevant=data.startswith('post_')or command in('/admin','/posts_admin','/cancel')
 if uid not in rem.admins():
  if relevant:
   if cb:bot.api('answerCallbackQuery',callback_query_id=cb['id'],text='Только для администратора',show_alert=True)
   else:say(uid,'Этот раздел доступен администратору Telefy. Проверка: /id')
   return True
  return False
 s=store()
 if command in('/start','/menu','/help'):s.cancel_input(uid);rem.store().cancel_upload(uid);return False
 if command=='/cancel':s.cancel_input(uid);rem.store().cancel_upload(uid);say(uid,'Редактирование отменено.');return True
 if command in('/admin','/posts_admin'):s.cancel_input(uid);rem.store().cancel_upload(uid);panel(uid);return True
 if cb and data.startswith('post_'):
  bot.api('answerCallbackQuery',callback_query_id=cb['id'])
  op,_,pid=data.partition(':');s.cancel_input(uid);rem.store().cancel_upload(uid)
  if op=='post_new':s.input(uid,'new');say(uid,'Отправь пост: текст с эмоджи или одно вложение с подписью. Можно сохранить форматирование Telegram. Отмена: /cancel');return True
  if op=='post_menu':panel(uid);return True
  if op=='post_list':
   recent=s.recent(uid)
   say(uid,'Последние посты'if recent else'Постов пока нет.',[[button(p['id'][:6]+' · '+p['status'],'post_preview:'+p['id'])]for p in recent]);return True
  if op=='post_templates':rem.admin_panel(uid);return True
  p=s.post(uid,pid)
  if not p:say(uid,'Пост не найден.');return True
  if op=='post_preview':deliver(uid,p['payload']);draft(uid,pid)
  elif op=='post_status':status(uid,pid)
  elif op=='post_back':s.review(uid,pid,back=True);draft(uid,pid)
  elif op=='post_cancel':s.cancel(uid,pid);say(uid,'Отправка отменена. Уже доставленные сообщения остаются у получателей.')
  elif op=='post_review':review_panel(uid,pid)
  elif op=='post_confirm':
   if s.confirm(uid,pid):say(uid,'Рассылка поставлена в очередь.',[[button('Статус','post_status:'+pid),button('Остановить','post_cancel:'+pid)]])
   else:status(uid,pid)
  elif p['status']!='draft':status(uid,pid)
  elif op in('post_text','post_media'):s.input(uid,'text'if op=='post_text'else'media',pid);say(uid,'Отправь новый текст.'if op=='post_text'else'Отправь фото, видео, GIF, аудио или документ. Подпись необязательна; без неё текст поста сохранится.')
  elif op=='post_clear':
   payload=p['payload'];payload['media']=None
   if not payload['body'].strip():say(uid,'Сначала добавь текст: без медиа пост станет пустым.')
   else:s.edit(uid,pid,payload);draft(uid,pid)
  elif op=='post_prepare':
   if s.review(uid,pid):review_panel(uid,pid)
  return True
 if cb or command.startswith('/'):return False
 pending=s.input(uid)
 if not pending:return False
 try:
  kind=pending['kind'];target=pending['target']
  if kind=='template':
   incoming=extract(msg)
   s.set_text(target,incoming['body'],incoming['entities']);s.cancel_input(uid);say(uid,'Текст, форматирование и premium-эмоджи сохранены ✅',[[button('Предпросмотр','rm_preview:'+target),button('Изменить текст','rm_text:'+target)]]);return True
  if kind=='new':pid=s.create(uid,extract(msg));s.cancel_input(uid);draft(uid,pid);return True
  p=s.post(uid,target)
  if not p or p['status']!='draft':s.cancel_input(uid);say(uid,'Этот пост уже нельзя редактировать. Создай новый.');return True
  payload=p['payload'];incoming=extract(msg)
  if kind=='media':
   if not incoming['media']:raise ValueError()
   payload['media']=incoming['media']
   if incoming['body']:payload['body']=incoming['body'];payload['entities']=incoming['entities']
  else:
   if not msg.get('text'):raise ValueError()
   payload['body']=incoming['body'];payload['entities']=incoming['entities']
  if text_size(payload['body'])>(1024 if payload['media']else 4096):raise ValueError()
  if not s.edit(uid,target,payload):raise ValueError()
  s.cancel_input(uid);draft(uid,target)
 except (ValueError,TypeError):say(uid,'Не удалось сохранить. Для текста приветствия/напоминания или подписи к медиа — до 1024 символов, для текстового поста — до 4096. Пришли подходящее сообщение ещё раз или /cancel.')
 return True

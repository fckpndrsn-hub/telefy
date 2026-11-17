"""Durable payment receipts. Ambiguous sends are never blindly repeated."""
import time,threading
from datetime import datetime,timezone,timedelta
LOCK=threading.RLock();STARTED=False
class NotificationStore:
 def __init__(self,db):self.db=db;self.ready=False
 def ensure(self):
  with LOCK:
   if self.ready:return
   self.db.ensure()
   with self.db.connect()as c:
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_max_media(id INTEGER PRIMARY KEY,file_id TEXT NOT NULL)')
    self.db.execute(c,'CREATE TABLE IF NOT EXISTS telefy_max_receipts(charge_id TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,expires_at BIGINT NOT NULL,file_id TEXT NOT NULL,state TEXT NOT NULL,retry_at BIGINT NOT NULL)')
   self.ready=True
 def media(self,file_id=None):
  self.ensure()
  with self.db.connect()as c:
   if file_id is not None:self.db.execute(c,'INSERT INTO telefy_max_media VALUES(1,%s) ON CONFLICT(id) DO UPDATE SET file_id=excluded.file_id',(file_id,));return
   r=self.db.execute(c,'SELECT file_id FROM telefy_max_media WHERE id=1').fetchone()
  return r['file_id']if r else''
 def queue(self,uid,charge,end):
  media=self.media()
  with self.db.connect()as c:self.db.execute(c,"INSERT INTO telefy_max_receipts VALUES(%s,%s,%s,%s,'pending',0) ON CONFLICT(charge_id) DO NOTHING",(charge,uid,end,media))
 def claim(self):
  self.ensure()
  with LOCK,self.db.connect()as c:
   r=self.db.execute(c,"SELECT * FROM telefy_max_receipts WHERE state='pending' AND retry_at<=%s ORDER BY expires_at LIMIT 1"+(' FOR UPDATE SKIP LOCKED'if self.db.url else''),(int(time.time()),)).fetchone()
   if not r:return None
   changed=self.db.execute(c,"UPDATE telefy_max_receipts SET state='sending' WHERE charge_id=%s AND state='pending'",(r['charge_id'],))
   return dict(r)if changed.rowcount==1 else None
 def finish(self,charge,state,retry=0):
  with self.db.connect()as c:self.db.execute(c,'UPDATE telefy_max_receipts SET state=%s,retry_at=%s WHERE charge_id=%s',(state,int(time.time())+retry,charge))

def store():
 import bot_reminders as rem
 db=rem.store().db
 with LOCK:
  if not getattr(db,'max_notifications',None):db.max_notifications=NotificationStore(db)
 result=db.max_notifications;result.ensure();return result

def run_one():
 import telefy_bot as bot
 s=store();job=s.claim()
 if not job:return False
 end=datetime.fromtimestamp(job['expires_at'],timezone(timedelta(hours=3))).strftime('%d.%m.%Y')
 text='Вы успешно оплатили Telefy Max.\n\nСрок действия подписки 30 дней\nДействие подписки: до '+end+'\n\n<b>Спасибо, что выбираете нас и наш сервис!</b>'
 import max_billing,max_gifts
 with s.db.connect()as c:order=s.db.execute(c,'SELECT id FROM telefy_star_orders WHERE charge_id=%s',(job['charge_id'],)).fetchone()
 gift=max_gifts.by_order(max_billing.STORE,order['id'])if order else None
 gift_url='https://t.me/'+bot.BOT_USERNAME+'?startapp=gift_'+gift['token']if gift else None
 gift_kind=None
 if gift:
  text='🎁 Подарок Telefy Max готов!\n\nОтправь ссылку другу. 30 дней начнутся после активации.\n\n'+gift_url
  with s.db.connect()as c:media=s.db.execute(c,'SELECT * FROM telefy_gift_media WHERE id=1').fetchone()
  job['file_id']=media['file_id']if media else'';gift_kind=media['kind']if media else None
 args={'chat_id':job['telegram_id'],'parse_mode':'HTML','reply_markup':{'inline_keyboard':[[{'text':'Открыть Telefy','style':'primary','web_app':{'url':bot.BASE+'/telefy.html'}}]]}}
 try:
  if gift and job['file_id']:bot.api({'photo':'sendPhoto','video':'sendVideo','animation':'sendAnimation'}[gift_kind],**args,**{gift_kind:job['file_id']},caption=text)
  elif job['file_id']:bot.api('sendPhoto',**args,photo=job['file_id'],caption=text)
  else:bot.api('sendMessage',**args,text=text)
  s.finish(job['charge_id'],'sent')
 except bot.BotError as e:
  if e.definitive and e.status==429:s.finish(job['charge_id'],'pending',max(1,e.retry_after))
  else:s.finish(job['charge_id'],'failed'if e.definitive else'uncertain')
 except Exception:s.finish(job['charge_id'],'uncertain')
 return True

def start():
 global STARTED
 if STARTED:return
 STARTED=True
 def worker():
  # A previous process may have died after Telegram accepted a message.
  try:
   s=store()
   with s.db.connect()as c:s.db.execute(c,"UPDATE telefy_max_receipts SET state='uncertain' WHERE state='sending'")
  except Exception:pass
  while True:
   try:
    if run_one():continue
   except Exception:pass
   time.sleep(2)
 threading.Thread(target=worker,name='max-receipts',daemon=True).start()

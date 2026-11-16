"""Native Telegram keyboard, verified membership, durable webhook worker."""
import os,json,time,secrets,base64,hashlib,hmac,html,threading
import bot_reminders as reminders
from urllib.parse import urlencode,urlsplit
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from bot_store import BotStore

TOKEN=os.environ.get('BOT_TOKEN','').strip()
CHANNEL=os.environ.get('REQUIRED_CHANNEL','@telefy_news').strip()
CHANNEL_URL=os.environ.get('CHANNEL_URL','https://t.me/telefy_news')
BASE=(os.environ.get('MINI_APP_URL')or os.environ.get('RENDER_EXTERNAL_URL')or'').rstrip('/')
BOT_USERNAME='TelefyApp_Bot';SCREENS={'home','profile','settings','max','support'}
LOCK=threading.RLock();MEMBERS={};WAKE=threading.Event();STARTED=False
DIAGNOSTIC={'state':'not_started'}
class BotError(Exception):
    def __init__(self,code='telegram_unavailable',retry_after=5,status=None,definitive=False):self.code=code;self.retry_after=max(1,min(int(retry_after),3600));self.status=status;self.definitive=definitive
class AccessDenied(Exception):pass
def cookie_user(*args,**kwargs):
    # Old bridge modules may still call this hook. Only the shared DB session is valid.
    raise AccessDenied('database_session_required')
def enabled():
    try:p=urlsplit(BASE);return bool(TOKEN and p.scheme=='https'and p.hostname and p.path in('','/')and not p.username and not p.password and not p.query and not p.fragment)
    except ValueError:return False
def store():
    import profile_server
    db=profile_server.DB
    with LOCK:
        if not getattr(db,'bot_store',None):db.bot_store=BotStore(db)
        return db.bot_store
def secret(label):return hmac.new(TOKEN.encode(),label.encode(),hashlib.sha256).digest()
def webhook_secret():return secret('telefy-webhook-v2').hex()
def api(method,**data):
    if not TOKEN:raise BotError('bot_not_configured')
    try:
        req=Request('https://api.telegram.org/bot'+TOKEN+'/'+method,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
        try:
            with urlopen(req,timeout=12)as response:result=json.load(response)
        except HTTPError as error:
            try:result=json.load(error)
            except Exception:raise BotError()from None
        if not result.get('ok'):raise BotError('telegram_rejected',(result.get('parameters')or{}).get('retry_after',5),result.get('error_code'),True)
        return result['result']
    except BotError:raise
    except Exception:raise BotError()from None
def active(member):return member.get('status')in('creator','administrator','member')or(member.get('status')=='restricted'and member.get('is_member')is True)
def subscribed(uid,cached=False):
    with LOCK:entry=MEMBERS.get(uid)
    if cached and entry and entry[0]>time.time():return entry[1]
    result=active(api('getChatMember',chat_id=CHANNEL,user_id=uid))
    with LOCK:
        if len(MEMBERS)>10000:MEMBERS.clear()
        MEMBERS[uid]=(time.time()+10,result)
    return result
def signed(payload):
    raw=base64.urlsafe_b64encode(json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode()).decode().rstrip('=')
    return raw+'.'+hmac.new(secret('launch-v2'),raw.encode(),hashlib.sha256).hexdigest()
def decode(ticket,allow_expired=False):
    try:
        if not isinstance(ticket,str)or not 0<len(ticket)<=4096:raise ValueError()
        raw,signature=ticket.split('.',1)
        expected=hmac.new(secret('launch-v2'),raw.encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,expected):raise ValueError()
        p=json.loads(base64.urlsafe_b64decode(raw+'='*(-len(raw)%4)))
        if type(p.get('uid'))is not int or not 0<p['uid']<2**53 or p.get('screen')not in SCREENS or type(p.get('exp'))is not int:raise ValueError()
        if not allow_expired and p['exp']<=time.time():raise ValueError()
        return p
    except Exception:raise AccessDenied('invalid_launch')from None
def launch_url(user,screen):
    p={'uid':user['id'],'screen':screen,'exp':int(time.time())+3600,'nonce':secrets.token_urlsafe(18)}
    ticket=signed(p);store().register_launch(ticket,user['id'],p['exp'])
    return BASE+'/bot/launch?'+urlencode({'ticket':ticket})
def keyboard(user):
    def button(text,screen):return {'text':text,'web_app':{'url':launch_url(user,screen)}}
    return {'keyboard':[[button('🎧 Открыть Mini App','home')],[button('👤 Мой профиль','profile'),button('⚙️ Настройки','settings')],[button('⭐ Telefy Max','max'),button('💬 Поддержка','support')]],'resize_keyboard':True,'is_persistent':True,'input_field_placeholder':'Выбери раздел Telefy'}
def show_menu(user):
    store().remember(user)
    reminders.register(user['id'])
    api('sendMessage',chat_id=user['id'],parse_mode='HTML',text='Привет, '+html.escape(user.get('first_name')or'друг')+'! 👋\n\n<b>Telefy</b> — твоя музыка без цензуры в Telegram.\n\nВо время бета-теста Telefy Max бесплатный. Открывай приложение и выбирай, что слушать.',reply_markup=keyboard(user))
    api('setChatMenuButton',chat_id=user['id'],menu_button={'type':'web_app','text':'Открыть Telefy','web_app':{'url':BASE+'/telefy.html'}})
def show_gate(user):
    api('sendMessage',chat_id=user['id'],text='Чтобы открыть Telefy, подпишись на @telefy_news.',reply_markup={'remove_keyboard':True})
    api('sendMessage',chat_id=user['id'],text='После подписки нажми «Проверить подписку».',reply_markup={'inline_keyboard':[[{'text':'Подписаться на канал','url':CHANNEL_URL}],[{'text':'Проверить подписку','callback_data':'check_subscription'}]]})
    api('setChatMenuButton',chat_id=user['id'],menu_button={'type':'commands'})
def same_channel(chat):return ('@'+str(chat.get('username',''))).casefold()==CHANNEL.casefold()or str(chat.get('id'))==CHANNEL
def valid_user(user):return isinstance(user,dict)and type(user.get('id'))is int and 0<user['id']<2**53 and user.get('is_bot')is not True
def handle(update):
    if reminders.handle(update):return
    own=update.get('my_chat_member')
    if isinstance(own,dict)and same_channel(own.get('chat',{})):
        DIAGNOSTIC.update(state='setup_retry'if(own.get('new_chat_member')or{}).get('status')in('administrator','creator')else'channel_admin_required');return
    event=update.get('chat_member')
    if isinstance(event,dict)and same_channel(event.get('chat',{})):
        new=event.get('new_chat_member')or{};user=new.get('user')or{}
        if not valid_user(user):return
        with LOCK:MEMBERS.pop(user['id'],None)
        if active(event.get('old_chat_member')or{})and not active(new):show_gate(user)
        return
    callback=update.get('callback_query')
    if isinstance(callback,dict):
        user=callback.get('from')or{}
        if callback.get('data')!='check_subscription'or not valid_user(user):return
        if subscribed(user['id']):
            api('answerCallbackQuery',callback_query_id=callback['id'],text='Подписка подтверждена');show_menu(user)
        else:api('answerCallbackQuery',callback_query_id=callback['id'],text='Подпишись на канал и проверь ещё раз.',show_alert=True)
        return
    message=update.get('message')or{};user=message.get('from')or{}
    if message.get('chat',{}).get('type')!='private'or not valid_user(user):return
    if message.get('text','').split(' ',1)[0].split('@')[0]not in('/start','/help','/menu'):return
    if subscribed(user['id']):show_menu(user)
    else:show_gate(user)
def submit(update):store().enqueue(update);WAKE.set();return True
def process_one():
    job=store().claim()
    if not job:return False
    try:handle(job['update']);store().finish(job)
    except BotError as e:store().finish(job,max(e.retry_after,min(300,2**min(job['attempt'],8))))
    except Exception:store().finish(job,30)
    return True
def setup():
    if not enabled():DIAGNOSTIC.update(state='configuration_required');return False
    try:
        me=api('getMe')
        if str(me.get('username','')).casefold()!=BOT_USERNAME.casefold():DIAGNOSTIC.update(state='bot_username_mismatch');return False
        if api('getChatMember',chat_id=CHANNEL,user_id=me['id']).get('status')not in('administrator','creator'):DIAGNOSTIC.update(state='channel_admin_required');return False
        api('setMyCommands',commands=[{'command':'start','description':'Открыть Telefy'},{'command':'help','description':'Меню Telefy'}])
        for uid in reminders.admins():api('setMyCommands',scope={'type':'chat','chat_id':uid},commands=[{'command':'start','description':'Открыть Telefy'},{'command':'id','description':'Мой Telegram ID'},{'command':'reminders_admin','description':'Медиа для напоминаний'}])
        api('setChatMenuButton',menu_button={'type':'web_app','text':'Открыть Telefy','web_app':{'url':BASE+'/telefy.html'}})
        api('setWebhook',url=BASE+'/bot/webhook',secret_token=webhook_secret(),allowed_updates=['message','callback_query','chat_member','my_chat_member'],drop_pending_updates=False)
        DIAGNOSTIC.update(state='ready');print('Telefy bot: webhook configured.',flush=True);return True
    except Exception:DIAGNOSTIC.update(state='setup_retry');return False
def start():
    global STARTED
    if STARTED:return
    STARTED=True
    reminders.start()
    def worker():
        next_setup=0
        while True:
            try:
                if time.monotonic()>=next_setup and DIAGNOSTIC['state']!='ready':setup();next_setup=time.monotonic()+60
                if process_one():continue
            except Exception:DIAGNOSTIC.update(state='database_retry')
            WAKE.wait(2);WAKE.clear()
    threading.Thread(target=worker,name='telefy-bot',daemon=True).start()
def gate_html(reason='subscription_required'):
    title='Подпишись на Telefy'if reason=='subscription_required'else'Открой Telefy через бота'
    desc='Для доступа нужна подписка на наш канал.'if reason=='subscription_required'else'Вернись в бота и нажми /start, чтобы получить новое меню.'
    return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telefy</title><style>body{font:16px/1.5 system-ui;background:#f2f2f7;color:#17212b;max-width:420px;margin:12vh auto;padding:24px}a{display:block;background:#2aabee;color:#fff;padding:14px;border-radius:14px;text-align:center;text-decoration:none;margin:12px 0}</style><h1>'+title+'</h1><p>'+desc+'</p><a href="'+html.escape(CHANNEL_URL,quote=True)+'">Канал Telefy</a><a href="https://t.me/TelefyApp_Bot?start=check">Открыть бота</a></html>'

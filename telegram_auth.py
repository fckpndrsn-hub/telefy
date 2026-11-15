"""Validate Telegram-signed Mini App data. Never trust initDataUnsafe."""
import hashlib,hmac,json,time,re
from urllib.parse import parse_qsl,urlsplit

class AuthError(ValueError):pass

def verify_init_data(raw,bot_token,now=None,max_age=3600):
    if not bot_token:raise AuthError('bot_not_configured')
    if not isinstance(raw,str) or not 0<len(raw)<=16384:raise AuthError('invalid_init_data')
    try:pairs=parse_qsl(raw,keep_blank_values=True,strict_parsing=True)
    except ValueError:raise AuthError('invalid_init_data') from None
    fields=dict(pairs)
    if len(fields)!=len(pairs):raise AuthError('duplicate_fields')
    signature=fields.pop('hash','')
    if not re.fullmatch(r'[a-f0-9]{64}',signature):raise AuthError('invalid_signature')
    check='\n'.join(k+'='+v for k,v in sorted(fields.items()))
    secret=hmac.new(b'WebAppData',bot_token.encode(),hashlib.sha256).digest()
    try:expected=hmac.new(secret,check.encode(),hashlib.sha256).hexdigest()
    except UnicodeError:raise AuthError('invalid_init_data') from None
    if not hmac.compare_digest(signature,expected):raise AuthError('invalid_signature')
    try:
        timestamp=int(fields['auth_date']);user=json.loads(fields['user'])
        uid=user['id']
        if isinstance(uid,bool) or not isinstance(uid,int) or not 0<uid<2**53:raise ValueError()
        age=(time.time() if now is None else now)-timestamp
        if age>max_age or age< -30:raise AuthError('expired_init_data')
        if not isinstance(user.get('first_name'),str):raise ValueError()
    except (KeyError,ValueError,TypeError):raise AuthError('invalid_user_or_date') from None
    def text(key,size):
        value=user.get(key)
        return value[:size] if isinstance(value,str) else None
    username=text('username',64)
    photo=text('photo_url',2048)
    try:
        parsed=urlsplit(photo or '')
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:photo=None
    except ValueError:photo=None
    return dict(telegram_id=uid,username=username,first_name=text('first_name',256),last_name=text('last_name',256),photo_url=photo,language_code=text('language_code',32),is_premium=int(user.get('is_premium') is True))

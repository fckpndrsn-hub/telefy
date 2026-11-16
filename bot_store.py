"""Durable webhook inbox and single-use launch exchange in the existing database."""
import json,time,threading,hashlib,secrets

class BotStore:
    def __init__(self,db):self.db=db;self.ready=False;self.lock=threading.Lock()
    def ensure(self):
        self.db.ensure()
        with self.lock:
            if self.ready:return
            with self.db.connect()as c:
                if self.db.url:self.db.execute(c,'SELECT pg_advisory_xact_lock(734620111)')
                self.db.execute(c,'''CREATE TABLE IF NOT EXISTS telefy_bot_updates (
                  update_id BIGINT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,
                  attempts INTEGER NOT NULL,next_at BIGINT NOT NULL,lease_until BIGINT NOT NULL,created_at BIGINT NOT NULL)''')
                self.db.execute(c,'''CREATE TABLE IF NOT EXISTS telefy_bot_launches (
                  token_hash TEXT PRIMARY KEY,telegram_id BIGINT NOT NULL,expires_at BIGINT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)''')
            self.ready=True
    def enqueue(self,update):
        if not isinstance(update,dict)or type(update.get('update_id'))is not int or update['update_id']<0:raise ValueError('invalid_update')
        payload=json.dumps(update,ensure_ascii=False)
        if len(payload.encode())>65536:raise ValueError('invalid_update')
        self.ensure();now=int(time.time())
        with self.db.connect()as c:
            self.db.execute(c,'INSERT INTO telefy_bot_updates VALUES(%s,%s,%s,0,%s,0,%s) ON CONFLICT(update_id) DO NOTHING',(update['update_id'],payload,'pending',now,now))
    def claim(self,now=None):
        self.ensure();now=int(time.time())if now is None else now
        with self.db.connect()as c:
            row=self.db.execute(c,"SELECT * FROM telefy_bot_updates WHERE (status='pending' AND next_at<=%s) OR (status='processing' AND lease_until<%s) ORDER BY update_id LIMIT 1"+(' FOR UPDATE SKIP LOCKED'if self.db.url else ''),(now,now)).fetchone()
            if not row:return None
            self.db.execute(c,"UPDATE telefy_bot_updates SET status='processing',attempts=attempts+1,lease_until=%s WHERE update_id=%s",(now+180,row['update_id']))
            return {'id':row['update_id'],'update':json.loads(row['payload']),'attempt':row['attempts']+1}
    def finish(self,job,retry=None):
        self.ensure();now=int(time.time())
        status='done'if retry is None else 'failed'if job['attempt']>=10 else 'pending'
        with self.db.connect()as c:
            self.db.execute(c,'UPDATE telefy_bot_updates SET status=%s,next_at=%s,lease_until=0,payload=CASE WHEN %s THEN payload ELSE %s END WHERE update_id=%s',(status,now+int(retry or 0),status=='pending','{}',job['id']))
            # Completed IDs remain briefly for replay protection, without message text.
            self.db.execute(c,"DELETE FROM telefy_bot_updates WHERE status IN ('done','failed') AND created_at<%s",(now-7*86400,))
    def register_launch(self,ticket,uid,expires):
        self.ensure();key=hashlib.sha256(ticket.encode()).hexdigest();now=int(time.time())
        with self.db.connect()as c:
            self.db.execute(c,'DELETE FROM telefy_bot_launches WHERE expires_at<%s',(now,))
            self.db.execute(c,'INSERT INTO telefy_bot_launches VALUES(%s,%s,%s,0) ON CONFLICT(token_hash) DO NOTHING',(key,uid,expires))
    def consume_launch(self,ticket,uid):
        self.ensure();key=hashlib.sha256(ticket.encode()).hexdigest()
        with self.db.connect()as c:
            row=self.db.execute(c,'UPDATE telefy_bot_launches SET consumed=1 WHERE token_hash=%s AND telegram_id=%s AND expires_at>%s AND consumed=0 RETURNING token_hash',(key,uid,int(time.time()))).fetchone()
            return bool(row)
    def exchange(self,ticket,uid):
        """Consume the bearer link and issue the ordinary app session atomically."""
        self.ensure();now=int(time.time());key=hashlib.sha256(ticket.encode()).hexdigest();token=secrets.token_urlsafe(32)
        with self.db.connect()as c:
            row=self.db.execute(c,'UPDATE telefy_bot_launches SET consumed=1 WHERE token_hash=%s AND telegram_id=%s AND expires_at>%s AND consumed=0 RETURNING token_hash',(key,uid,now)).fetchone()
            if not row:return None
            user=self.db.execute(c,'SELECT * FROM telefy_users WHERE telegram_id=%s',(uid,)).fetchone()
            if not user:raise ValueError('missing_user')
            self.db.execute(c,'INSERT INTO telefy_user_sessions VALUES(%s,%s,%s,%s)',(hashlib.sha256(token.encode()).hexdigest(),uid,now,now+604800))
            self.db.execute(c,'UPDATE telefy_users SET last_login_at=%s WHERE telegram_id=%s',(now,uid))
            return token,dict(user)
    def remember(self,user):
        """Upsert a bot-verified identity without overwriting known avatar/preferences."""
        self.db.ensure();now=int(time.time());uid=user['id']
        with self.db.connect()as c:
            self.db.execute(c,'''INSERT INTO telefy_users VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,photo_url=COALESCE(telefy_users.photo_url,excluded.photo_url),updated_at=excluded.updated_at''',(uid,user.get('username'),user.get('first_name')or'Пользователь',user.get('last_name'),'/api/me/avatar',user.get('language_code','ru'),int(user.get('is_premium')is True),now,now,now))
            return dict(self.db.execute(c,'SELECT * FROM telefy_users WHERE telegram_id=%s',(uid,)).fetchone())

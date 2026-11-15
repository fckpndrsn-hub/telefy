"""PostgreSQL in production. Explicit SQLite path only for local development."""
import os,sqlite3,time,secrets,hashlib,threading
from pathlib import Path
from contextlib import contextmanager

class DatabaseUnavailable(Exception):pass
class UserDatabase:
    def __init__(self,url=None,sqlite_path=None):
        self.url=os.environ.get('DATABASE_URL','') if url is None else url
        self.sqlite_path=sqlite_path or os.environ.get('TELEFY_DEV_SQLITE_PATH')
        self.lock=threading.Lock();self.initialized=False
    @contextmanager
    def connect(self):
        try:
            if self.url:
                import psycopg
                from psycopg.rows import dict_row
                conn=psycopg.connect(self.url,connect_timeout=8,row_factory=dict_row)
            elif self.sqlite_path and not os.environ.get('RENDER'):
                conn=sqlite3.connect(self.sqlite_path,timeout=8);conn.row_factory=sqlite3.Row
                conn.execute('PRAGMA foreign_keys=ON')
            else:raise DatabaseUnavailable('database_not_configured')
        except DatabaseUnavailable:raise
        except Exception:raise DatabaseUnavailable('database_unavailable') from None
        try:
            with conn:yield conn
        finally:conn.close()
    def execute(self,conn,sql,params=()):
        return conn.execute(sql if self.url else sql.replace('%s','?'),params)
    def ensure(self):
        with self.lock:
            if self.initialized:return
            with self.connect() as conn:
                for sql in Path(__file__).with_name('schema.sql').read_text().split(';'):
                    if sql.strip():self.execute(conn,sql)
            self.initialized=True
    def login(self,user):
        self.ensure();now=int(time.time());token=secrets.token_urlsafe(32);hashed=hashlib.sha256(token.encode()).hexdigest()
        keys=['telegram_id','username','first_name','last_name','photo_url','language_code','is_premium']
        with self.connect() as conn:
            self.execute(conn,'''INSERT INTO telefy_users(telegram_id,username,first_name,last_name,photo_url,language_code,is_premium,created_at,updated_at,last_login_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,
                photo_url=excluded.photo_url,language_code=excluded.language_code,is_premium=excluded.is_premium,updated_at=excluded.updated_at,last_login_at=excluded.last_login_at''',tuple(user[k] for k in keys)+(now,now,now))
            self.execute(conn,'DELETE FROM telefy_user_sessions WHERE expires_at<=%s',(now,))
            self.execute(conn,'INSERT INTO telefy_user_sessions VALUES(%s,%s,%s,%s)',(hashed,user['telegram_id'],now,now+604800))
        return token,self.profile(token)
    def profile(self,token):
        if not isinstance(token,str) or not 20<len(token)<128:return None
        self.ensure();hashed=hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as conn:
            row=self.execute(conn,'''SELECT u.* FROM telefy_users u JOIN telefy_user_sessions s ON s.telegram_id=u.telegram_id
                WHERE s.token_hash=%s AND s.expires_at>%s''',(hashed,int(time.time()))).fetchone()
        return dict(row) if row else None
    def logout(self,token):
        self.ensure()
        with self.connect() as conn:self.execute(conn,'DELETE FROM telefy_user_sessions WHERE token_hash=%s',(hashlib.sha256(token.encode()).hexdigest(),))

    def taste(self,uid):
        import json
        self.ensure()
        with self.connect() as conn:
            rows=self.execute(conn,'SELECT record_json FROM telefy_taste_events WHERE telegram_id=%s ORDER BY played_at DESC,event_id DESC LIMIT 20',(uid,)).fetchall()
        return list(reversed([json.loads(row['record_json']) for row in rows]))
    def record_taste(self,uid,record):
        import json
        self.ensure()
        with self.connect() as conn:
            # Serialize concurrent updates to the same account in PostgreSQL.
            if self.url:self.execute(conn,'SELECT telegram_id FROM telefy_users WHERE telegram_id=%s FOR UPDATE',(uid,))
            self.execute(conn,'INSERT INTO telefy_taste_events VALUES(%s,%s,%s,%s) ON CONFLICT(telegram_id,event_id) DO NOTHING',(uid,record['eventId'],record['at'],json.dumps(record)))
            self.execute(conn,'DELETE FROM telefy_taste_events WHERE telegram_id=%s AND event_id NOT IN (SELECT event_id FROM telefy_taste_events WHERE telegram_id=%s ORDER BY played_at DESC,event_id DESC LIMIT 20)',(uid,uid))
        return self.taste(uid)

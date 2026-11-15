CREATE TABLE IF NOT EXISTS telefy_users (
 telegram_id BIGINT PRIMARY KEY,
 username TEXT,
 first_name TEXT NOT NULL,
 last_name TEXT,
 photo_url TEXT,
 language_code TEXT,
 is_premium INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL,
 last_login_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS telefy_users_username_idx ON telefy_users(username);
CREATE TABLE IF NOT EXISTS telefy_user_sessions (
 token_hash TEXT PRIMARY KEY,
 telegram_id BIGINT NOT NULL REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,
 created_at BIGINT NOT NULL,
 expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS telefy_sessions_expiry_idx ON telefy_user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS telefy_taste_events (
 telegram_id BIGINT NOT NULL REFERENCES telefy_users(telegram_id) ON DELETE CASCADE,
 event_id TEXT NOT NULL,
 played_at BIGINT NOT NULL,
 record_json TEXT NOT NULL,
 PRIMARY KEY(telegram_id,event_id)
);
CREATE INDEX IF NOT EXISTS telefy_taste_recent_idx ON telefy_taste_events(telegram_id,played_at);

-- M38: Operations — session management metadata.
-- user_agent: the User-Agent of the device that created the session.
-- last_seen_at: refreshed on every authenticated request (sliding expiry).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

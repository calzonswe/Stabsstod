-- M5: Authentication — add password_hash to users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

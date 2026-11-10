-- M6: User administration
-- Adds disabled + preferred_language to users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'sv';

-- Seed default system settings (idempotent).
INSERT INTO settings (key, value) VALUES
  ('timezone', '"Europe/Stockholm"'),
  ('map.onlineTileUrl', 'null'),
  ('maxUploadMB', '25')
ON CONFLICT (key) DO NOTHING;

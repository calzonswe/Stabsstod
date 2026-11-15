-- M37: Wall display mode
-- Seed the wall rotation interval setting (idempotent).
INSERT INTO settings (key, value) VALUES
  ('wall.rotateEverySeconds', '30')
ON CONFLICT (key) DO NOTHING;

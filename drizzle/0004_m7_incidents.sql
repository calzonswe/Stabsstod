-- M7: Incidents, members, functions
-- Extends incidents with type, start time and status.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Default check constraint for status (idempotent via DO block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incidents_status_check'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_status_check
      CHECK (status IN ('active', 'winding_down', 'closed'));
  END IF;
END $$;

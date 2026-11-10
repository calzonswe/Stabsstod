-- M4: Core schema and append-only records table.
-- Creates all non-operational tables plus the append-only `records` table.
-- Triggers reject UPDATE and DELETE on `records`.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text,
  role text NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, -- hashed session token
  user_id text NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  title text NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_members (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'member',
  UNIQUE (incident_id, user_id)
);

CREATE TABLE IF NOT EXISTS staff_functions (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS function_members (
  id text PRIMARY KEY,
  function_id text NOT NULL REFERENCES staff_functions(id),
  user_id text NOT NULL REFERENCES users(id),
  UNIQUE (function_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_events (
  id text PRIMARY KEY,
  type text NOT NULL, -- login | logout | failed_login | ...
  username text NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Operational table: records — append-only versioned log
CREATE TABLE IF NOT EXISTS records (
  id text PRIMARY KEY, -- uuidv7, generated on the client
  entity_id text NOT NULL,
  entity_type text NOT NULL,
  incident_id text NOT NULL,
  parent_ids text[] NOT NULL DEFAULT '{}',
  function_id text, -- owning staff function; null = incident-wide
  author_id text NOT NULL,
  device_id text NOT NULL, -- random id per browser profile
  hlc text NOT NULL, -- hybrid logical clock, sortable string
  created_at_client timestamptz NOT NULL, -- ISO UTC
  kind text NOT NULL, -- 'put' | 'retract'
  schema_version integer NOT NULL,
  payload jsonb NOT NULL, -- validated by entityType zod schema
  server_seq bigserial NOT NULL, -- global pull order, server-assigned
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS records_incident_id_server_seq_idx
  ON records (incident_id, server_seq);
CREATE INDEX IF NOT EXISTS records_incident_id_entity_id_idx
  ON records (incident_id, entity_id);

-- Append-only enforcement: raise an exception on UPDATE or DELETE of records.
CREATE OR REPLACE FUNCTION reject_records_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'records table is append-only: UPDATE is not allowed';
END;
$$;

CREATE OR REPLACE FUNCTION reject_records_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'records table is append-only: DELETE is not allowed';
END;
$$;

DROP TRIGGER IF EXISTS records_no_update ON records;
DROP TRIGGER IF EXISTS records_no_delete ON records;

CREATE TRIGGER records_no_update
  BEFORE UPDATE ON records
  FOR EACH ROW
  EXECUTE FUNCTION reject_records_update();

CREATE TRIGGER records_no_delete
  BEFORE DELETE ON records
  FOR EACH ROW
  EXECUTE FUNCTION reject_records_delete();

-- M31: Administrative areas and search
-- Tables: places (name, kind, lat, lon, kommun, lan, bbox) and
-- admin_areas (name, kind, geojson). pg_trgm trigram search on name.

-- Enable the pg_trgm extension for trigram similarity search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Populated places, streets, addresses and named points of interest.
CREATE TABLE IF NOT EXISTS places (
  id   text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,            -- place | commune | county | street | address
  lat  double precision NOT NULL,
  lon  double precision NOT NULL,
  kommun text,
  lan  text,
  bbox text                       -- "minLon,minLat,maxLon,maxLat" as text (no PostGIS)
);

-- Administrative area boundaries (län / kommun polygons) as GeoJSON.
CREATE TABLE IF NOT EXISTS admin_areas (
  id      text PRIMARY KEY,
  name    text NOT NULL,
  kind    text NOT NULL,          -- county | municipality
  geojson jsonb NOT NULL          -- GeoJSON Polygon/MultiPolygon geometry
);

-- Rename column if a previous draft created it with the Swedish character.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'places' AND column_name = 'län'
  ) THEN
    ALTER TABLE places RENAME COLUMN "län" TO lan;
  END IF;
END $$;

-- Trigram indexes for fuzzy name search on both tables.
CREATE INDEX IF NOT EXISTS places_name_trgm_idx
  ON places USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS admin_areas_name_trgm_idx
  ON admin_areas USING gin (name gin_trgm_ops);

-- Helpful lookups.
CREATE INDEX IF NOT EXISTS places_kommun_idx ON places (kommun);
CREATE INDEX IF NOT EXISTS places_lan_idx ON places (lan);
CREATE INDEX IF NOT EXISTS admin_areas_kind_idx ON admin_areas (kind);

CREATE TABLE IF NOT EXISTS sites (
  id serial PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  ac_capacity_kw real,
  dc_capacity_kw real,
  notes text,
  username text,
  password text,
  api_key text,
  credential_key text,
  site_identifier text,
  provider_config jsonb,
  scraper_type text NOT NULL DEFAULT 'mock',
  last_synced_at timestamptz,
  sync_started_at timestamptz,
  status text NOT NULL DEFAULT 'idle',
  last_error text,
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS readings (
  id serial PRIMARY KEY,
  site_id integer NOT NULL,
  timestamp timestamptz NOT NULL,
  energy_wh real NOT NULL,
  power_w real
);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS sync_started_at timestamptz;
UPDATE sites SET timezone = 'America/Chicago' WHERE timezone IS NULL OR btrim(timezone) = '';
ALTER TABLE sites ALTER COLUMN timezone SET DEFAULT 'America/Chicago';
ALTER TABLE sites ALTER COLUMN timezone SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'sites'
      AND column_name = 'last_synced_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE sites
      ALTER COLUMN last_synced_at TYPE timestamptz
      USING last_synced_at AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'sites'
      AND column_name = 'archived_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE sites
      ALTER COLUMN archived_at TYPE timestamptz
      USING archived_at AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'readings'
      AND column_name = 'timestamp'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE readings
      ALTER COLUMN timestamp TYPE timestamptz
      USING timestamp AT TIME ZONE 'UTC';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM readings r
    LEFT JOIN sites s ON s.id = r.site_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add readings foreign key: orphaned readings exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'readings'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE readings
      ADD CONSTRAINT readings_site_id_sites_id_fk
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sites
    WHERE scraper_type NOT IN ('solaredge_api', 'solaredge_browser', 'egauge', 'alsoenergy', 'mock')
  ) THEN
    RAISE EXCEPTION 'Cannot constrain scraper_type: unsupported values exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM sites
    WHERE status NOT IN ('idle', 'scraping', 'error')
  ) THEN
    RAISE EXCEPTION 'Cannot constrain status: unsupported values exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sites'::regclass
      AND conname = 'sites_scraper_type_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_scraper_type_check
      CHECK (scraper_type IN ('solaredge_api', 'solaredge_browser', 'egauge', 'alsoenergy', 'mock'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sites'::regclass
      AND conname = 'sites_status_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_status_check
      CHECK (status IN ('idle', 'scraping', 'error'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS readings_site_timestamp_unique
  ON readings (site_id, timestamp);
CREATE INDEX IF NOT EXISTS readings_timestamp_idx
  ON readings (timestamp);

CREATE TABLE IF NOT EXISTS sync_leases (
  name text PRIMARY KEY,
  owner_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_leases_expires_at_idx
  ON sync_leases (expires_at);

CREATE TABLE IF NOT EXISTS "session" (
  sid varchar PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire"
  ON "session" (expire);

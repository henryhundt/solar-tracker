CREATE TABLE inverter_fault_status (
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  name text NOT NULL,
  checked_at timestamptz NOT NULL,
  complete boolean NOT NULL,
  faults jsonb NOT NULL,
  PRIMARY KEY (site_id, device_id)
);

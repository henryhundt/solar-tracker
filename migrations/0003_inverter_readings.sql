CREATE TABLE inverter_readings (
  site_id integer NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  name text NOT NULL,
  timestamp timestamptz NOT NULL,
  power_w double precision NOT NULL,
  PRIMARY KEY (site_id, device_id, timestamp)
);

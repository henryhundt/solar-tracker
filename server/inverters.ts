import { pool } from "./db";
import type { InverterReading } from "@shared/inverters";

export async function saveInverterReadings(siteId: number, rows: InverterReading[]) {
  if (!rows.length) return;
  await pool.query(`
    INSERT INTO inverter_readings (site_id, device_id, name, timestamp, power_w)
    SELECT DISTINCT ON ("deviceId", timestamp) $1, "deviceId", name, timestamp, "powerW"
    FROM jsonb_to_recordset($2::jsonb)
      AS r("deviceId" text, name text, timestamp timestamptz, "powerW" double precision)
    ON CONFLICT (site_id, device_id, timestamp)
    DO UPDATE SET name = EXCLUDED.name, power_w = EXCLUDED.power_w
  `, [siteId, JSON.stringify(rows)]);
}

export async function latestInverterReadings(siteId: number): Promise<InverterReading[]> {
  const result = await pool.query(`
    SELECT DISTINCT ON (device_id) device_id AS "deviceId", name, timestamp, power_w AS "powerW"
    FROM inverter_readings WHERE site_id = $1 ORDER BY device_id, timestamp DESC
  `, [siteId]);
  return result.rows;
}

export async function inverterHistory(siteId: number, deviceId: string): Promise<InverterReading[]> {
  const result = await pool.query(`
    SELECT device_id AS "deviceId", name, timestamp, power_w AS "powerW"
    FROM inverter_readings WHERE site_id = $1 AND device_id = $2
      AND timestamp >= (
        SELECT max(timestamp) - interval '24 hours' FROM inverter_readings
        WHERE site_id = $1 AND device_id = $2
      )
    ORDER BY timestamp
  `, [siteId, deviceId]);
  return result.rows;
}

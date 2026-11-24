import { pool } from "./db";
import type { InverterFaultSnapshot, InverterOverview, InverterReading } from "@shared/inverters";

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

export async function saveInverterFaults(siteId: number, rows: InverterFaultSnapshot[]) {
  if (!rows.length) return;
  await pool.query(`
    INSERT INTO inverter_fault_status (site_id, device_id, name, checked_at, complete, faults)
    SELECT DISTINCT ON ("deviceId") $1, "deviceId", name, "checkedAt", complete, faults
    FROM jsonb_to_recordset($2::jsonb) AS r("deviceId" text, name text, "checkedAt" timestamptz, complete boolean, faults jsonb)
    ORDER BY "deviceId", "checkedAt" DESC
    ON CONFLICT (site_id, device_id) DO UPDATE SET name = EXCLUDED.name, checked_at = EXCLUDED.checked_at,
      complete = EXCLUDED.complete, faults = EXCLUDED.faults
    WHERE inverter_fault_status.checked_at < EXCLUDED.checked_at
  `, [siteId, JSON.stringify(rows)]);
}

export async function latestInverterReadings(siteId: number): Promise<InverterOverview[]> {
  const result = await pool.query(`
    WITH power AS (
      SELECT DISTINCT ON (device_id) device_id, name, timestamp, power_w
      FROM inverter_readings WHERE site_id = $1 ORDER BY device_id, timestamp DESC
    ), status AS (SELECT * FROM inverter_fault_status WHERE site_id = $1)
    SELECT device_id AS "deviceId", coalesce(power.name,status.name) AS name,
      timestamp, power_w AS "powerW", checked_at AS "faultCheckedAt", complete AS "faultsComplete", faults
    FROM power FULL JOIN status USING (device_id)
    ORDER BY jsonb_array_length(faults) DESC NULLS LAST, device_id
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

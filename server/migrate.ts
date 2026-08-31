import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./db";

const MIGRATION_FILE_PATTERN = /^\d+.*\.sql$/;
const MIGRATION_LOCK_NAME = "solar-tracker-migrations";

async function runMigrations(): Promise<void> {
  const migrationsDirectory = process.env.MIGRATIONS_DIR || join(process.cwd(), "migrations");
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort();
  if (migrationFiles.length === 0) {
    throw new Error(`No migration files found in ${migrationsDirectory}.`);
  }
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS solar_tracker_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM solar_tracker_migrations",
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.name, row.checksum]));

    for (const file of migrationFiles) {
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existingChecksum = applied.get(file);

      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(`Applied migration ${file} has been modified.`);
        }
        continue;
      }

      console.log(`Applying migration ${file}...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO solar_tracker_migrations (name, checksum) VALUES ($1, $2)",
          [file, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log(`Database migrations are current (${migrationFiles.length} known).`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
});

// Idle connections can fail during database restarts or credential rotation.
// Register this for every entry point, including migrations and standalone syncs.
pool.on("error", (error) => {
  console.error("Database pool connection failed:", { code: (error as Error & { code?: string }).code });
});
export const db = drizzle(pool, { schema });

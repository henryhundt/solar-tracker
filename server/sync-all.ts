import { pool } from "./db";
import { logSyncSummary, syncAllSites } from "./scheduler";
import { initializeCredentialEncryption } from "./credentials";

async function main(): Promise<void> {
  await initializeCredentialEncryption();
  const result = await syncAllSites();
  if (!result.started) {
    throw new Error("A full sync is already running.");
  }

  logSyncSummary("Full sync", result.summary);
  if (result.summary.failed > 0 || result.summary.skipped > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Full sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

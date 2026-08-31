import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { storage } from "./storage";
import { scrapeSite } from "./scraper";
import { trackBackgroundTask } from "./sync-runtime";

const DEFAULT_SYNC_CRON = "0 1 * * *";
const DEFAULT_SYNC_TIMEZONE = "America/Chicago";
const SYNC_ALL_LEASE_NAME = "sync-all-sites";
const DEFAULT_LEASE_MS = 4 * 60 * 60 * 1000;

export interface SiteSyncOutcome {
  siteId: number;
  siteName: string;
  success: boolean;
  skipped: boolean;
  readingsCount: number;
  error?: string;
}

export interface SyncAllSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: SiteSyncOutcome[];
}

export type SyncAllStartResult =
  | { started: false }
  | { started: true; completion: Promise<SyncAllSummary> };

export type SyncAllRunResult =
  | { started: false }
  | { started: true; summary: SyncAllSummary };

export function startScheduler() {
  if (process.env.ENABLE_INTERNAL_SCHEDULER === "false") {
    console.log("Internal scheduler disabled via ENABLE_INTERNAL_SCHEDULER=false");
    return;
  }

  const schedule = process.env.SYNC_CRON || DEFAULT_SYNC_CRON;
  const timezone = process.env.SYNC_TIMEZONE || DEFAULT_SYNC_TIMEZONE;

  console.log(`Starting sync scheduler (${schedule}, timezone: ${timezone})...`);

  cron.schedule(schedule, () => {
    const task = syncAllSites().then((result) => {
      if (!result.started) {
        console.log("Scheduled full sync skipped because another full sync owns the lease.");
        return;
      }

      logSyncSummary("Scheduled full sync", result.summary);
    });
    return trackBackgroundTask(task, "Scheduled full sync");
  }, {
    timezone,
    noOverlap: true,
  });

  console.log(`Scheduler started: ${schedule} (${timezone})`);
}

export async function startSyncAllSites(): Promise<SyncAllStartResult> {
  const ownerId = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local"}:${process.pid}:${randomUUID()}`;
  const leaseMs = getLeaseDurationMs();
  const acquired = await storage.acquireSyncLease(SYNC_ALL_LEASE_NAME, ownerId, leaseMs);

  if (!acquired) {
    return { started: false };
  }

  return {
    started: true,
    completion: runClaimedSyncAllSites(ownerId, leaseMs),
  };
}

export async function syncAllSites(): Promise<SyncAllRunResult> {
  const run = await startSyncAllSites();
  if (!run.started) {
    return run;
  }

  return {
    started: true,
    summary: await run.completion,
  };
}

async function runClaimedSyncAllSites(ownerId: string, leaseMs: number): Promise<SyncAllSummary> {
  let leaseHealthy = true;
  let renewingLease = false;
  const heartbeatMs = Math.max(30_000, Math.min(Math.floor(leaseMs / 3), 5 * 60 * 1000));
  const leaseHeartbeat = setInterval(async () => {
    if (renewingLease) {
      return;
    }

    renewingLease = true;
    try {
      leaseHealthy = await storage.renewSyncLease(SYNC_ALL_LEASE_NAME, ownerId, leaseMs);
      if (!leaseHealthy) {
        console.error("Full-sync lease was lost; no additional sites will be started.");
      }
    } catch (error) {
      leaseHealthy = false;
      console.error("Failed to renew full-sync lease:", error);
    } finally {
      renewingLease = false;
    }
  }, heartbeatMs);
  leaseHeartbeat.unref();

  const results: SiteSyncOutcome[] = [];

  try {
    const sites = await storage.getSites();
    console.log(`Syncing ${sites.length} site(s)...`);

    for (const site of sites) {
      if (!leaseHealthy) {
        results.push({
          siteId: site.id,
          siteName: site.name,
          success: false,
          skipped: true,
          readingsCount: 0,
          error: "Full-sync lease was lost before this site started.",
        });
        continue;
      }

      try {
        console.log(`Starting sync for site: ${site.name} (ID: ${site.id})`);
        const result = await scrapeSite(site);
        results.push({
          siteId: site.id,
          siteName: site.name,
          success: result.success,
          skipped: Boolean(result.skipped),
          readingsCount: result.readingsCount ?? 0,
          error: result.error,
        });

        if (result.success && !result.skipped) {
          console.log(`Completed sync for site: ${site.name}`);
        } else if (result.skipped) {
          console.log(`Skipped sync for site ${site.name}: ${result.error || "already in progress"}`);
        } else {
          console.error(`Sync failed for site ${site.name}: ${result.error || "unknown error"}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Sync crashed for site ${site.name}:`, error);
        results.push({
          siteId: site.id,
          siteName: site.name,
          success: false,
          skipped: false,
          readingsCount: 0,
          error: message,
        });
      }
    }

    return summarizeResults(sites.length, results);
  } finally {
    clearInterval(leaseHeartbeat);
    await storage.releaseSyncLease(SYNC_ALL_LEASE_NAME, ownerId).catch((error) => {
      console.error("Failed to release full-sync lease:", error);
    });
  }
}

function summarizeResults(total: number, results: SiteSyncOutcome[]): SyncAllSummary {
  return {
    total,
    succeeded: results.filter((result) => result.success && !result.skipped).length,
    failed: results.filter((result) => !result.success && !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    results,
  };
}

export function logSyncSummary(label: string, summary: SyncAllSummary): void {
  console.log(
    `${label} complete: ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.skipped} skipped (${summary.total} total).`,
  );
}

function getLeaseDurationMs(): number {
  const configured = Number(process.env.SYNC_LEASE_MINUTES);
  if (!Number.isFinite(configured) || configured < 10) {
    return DEFAULT_LEASE_MS;
  }

  return configured * 60 * 1000;
}

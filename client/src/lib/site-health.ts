const STALE_SYNC_HOURS = 36;

export type SyncHealth = "fresh" | "stale" | "never";

export function getSyncHealth(lastSyncedAt?: Date | string | null, now = new Date()): SyncHealth {
  if (!lastSyncedAt) {
    return "never";
  }

  const syncDate = new Date(lastSyncedAt);
  if (Number.isNaN(syncDate.getTime())) {
    return "never";
  }

  const elapsedMs = now.getTime() - syncDate.getTime();
  return elapsedMs > STALE_SYNC_HOURS * 60 * 60 * 1000 ? "stale" : "fresh";
}

export function siteNeedsReview(
  site: { status: string; lastSyncedAt?: Date | string | null },
  now = new Date()
) {
  return site.status === "error" || getSyncHealth(site.lastSyncedAt, now) !== "fresh";
}

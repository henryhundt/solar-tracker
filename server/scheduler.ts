import cron from "node-cron";
import { storage } from "./storage";
import { scrapeSite } from "./scraper";

const DEFAULT_SYNC_CRON = "0 1 * * *";
const DEFAULT_SYNC_TIMEZONE = "America/Chicago";

export function startScheduler() {
  if (process.env.ENABLE_INTERNAL_SCHEDULER === "false") {
    console.log("Internal scheduler disabled via ENABLE_INTERNAL_SCHEDULER=false");
    return;
  }

  const schedule = process.env.SYNC_CRON || DEFAULT_SYNC_CRON;
  const timezone = process.env.SYNC_TIMEZONE || DEFAULT_SYNC_TIMEZONE;

  console.log(`Starting sync scheduler (${schedule}, timezone: ${timezone})...`);

  cron.schedule(schedule, async () => {
    console.log("Running daily auto-sync for all sites...");
    await syncAllSites();
  }, {
    timezone,
  });

  console.log(`Scheduler started: ${schedule} (${timezone})`);
}

export async function syncAllSites() {
  try {
    const sites = await storage.getSites();
    console.log(`Auto-syncing ${sites.length} site(s)...`);

    for (const site of sites) {
      if (site.status === "scraping") {
        console.log(`Skipping ${site.name} because a sync is already in progress.`);
        continue;
      }

      try {
        console.log(`Starting sync for site: ${site.name} (ID: ${site.id})`);
        await scrapeSite(site);
        console.log(`Completed sync for site: ${site.name}`);
      } catch (err) {
        console.error(`Failed to sync site ${site.name}:`, err);
      }
    }

    console.log("Daily auto-sync complete.");
  } catch (err) {
    console.error("Failed to run daily auto-sync:", err);
  }
}

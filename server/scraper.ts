import type { Site } from "@shared/schema";
import { getAlsoEnergyApiSiteId, getAlsoEnergyBrowserSiteKey } from "@shared/alsoenergy";
import { buildIncrementalHistoryWindow, getHourlyHistoryCutoff } from "./history";
import { storage } from "./storage";
import { scrapeEGauge } from "./scrapers/egauge";
import { scrapeAlsoEnergy } from "./scrapers/alsoenergy";
import { scrapeSolarEdgeAPI } from "./scrapers/solaredge-api";
import { scrapeSolarEdgeBrowser } from "./scrapers/solaredge-browser";
import { scrapeAlsoEnergyBrowser } from "./scrapers/alsoenergy-browser";
import { scrapeMock } from "./scrapers/mock";

interface ScraperResult {
  success: boolean;
  error?: string;
  readingsCount?: number;
  skipped?: boolean;
}

export async function scrapeSite(site: Site): Promise<ScraperResult> {
  const currentSite = await storage.getSite(site.id);

  if (!currentSite) {
    return { success: false, error: "Site not found" };
  }

  if (currentSite.archivedAt) {
    console.log(`Skipping archived site: ${currentSite.name} (ID: ${currentSite.id})`);
    return { success: true, skipped: true, readingsCount: 0 };
  }

  await storage.updateSite(currentSite.id, { status: "scraping", lastError: null });

  try {
    console.log(`Starting scrape for site: ${currentSite.name} (${currentSite.scraperType})`);
    const readingBounds = await storage.getReadingBounds(currentSite.id);
    const historyWindow = buildIncrementalHistoryWindow(readingBounds);

    let username = currentSite.username;
    let password = currentSite.password;
    let url = currentSite.url;
    let apiKey = currentSite.apiKey;

    if (currentSite.credentialKey) {
      username = process.env[`${currentSite.credentialKey}_USERNAME`] || username;
      password = process.env[`${currentSite.credentialKey}_PASSWORD`] || password;
      url = process.env[`${currentSite.credentialKey}_URL`] || url;
      apiKey = process.env[`${currentSite.credentialKey}_API_KEY`] || apiKey;
    }

    let readings: Array<{
      siteId: number;
      timestamp: Date;
      energyWh: number;
      powerW: number;
    }> = [];

    switch (currentSite.scraperType) {
      case "egauge":
        if (!url) {
          throw new Error("eGauge requires a device URL");
        }
        readings = await scrapeEGauge(currentSite, url, username ?? "", password ?? "", historyWindow);
        break;

      case "solaredge_api":
        if (!apiKey) {
          throw new Error("SolarEdge API requires an API key");
        }
        if (!currentSite.siteIdentifier) {
          throw new Error("SolarEdge API requires a Site ID in the Site Identifier field");
        }
        readings = await scrapeSolarEdgeAPI(currentSite, apiKey, currentSite.siteIdentifier, historyWindow);
        break;

      case "solaredge_browser":
        if (!username || !password) {
          throw new Error("SolarEdge Browser automation requires username and password");
        }
        readings = await scrapeSolarEdgeBrowser(currentSite, username, password, historyWindow);
        break;

      case "alsoenergy":
        if (!username || !password) {
          throw new Error("Also Energy requires username and password");
        }
        try {
          if (getAlsoEnergyApiSiteId(currentSite)) {
            readings = await scrapeAlsoEnergy(currentSite, url ?? "", username, password, apiKey, historyWindow);
          } else {
            readings = await scrapeAlsoEnergyBrowser(currentSite, username, password, historyWindow);
          }
        } catch (error: any) {
          if (!getAlsoEnergyBrowserSiteKey(currentSite)) {
            throw error;
          }

          console.log(`[AlsoEnergy] API path unavailable for ${currentSite.name}, falling back to browser scraper: ${error.message}`);
          readings = await scrapeAlsoEnergyBrowser(currentSite, username, password, historyWindow);
        }
        break;

      case "mock":
      default:
        readings = await scrapeMock(currentSite, historyWindow);
        break;
    }

    if (readings.length > 0) {
      if (currentSite.scraperType === "egauge") {
        const replacedReadings = await storage.deleteReadingsInRange(
          currentSite.id,
          historyWindow.start,
          historyWindow.end
        );
        if (replacedReadings > 0) {
          console.log(`Replaced ${replacedReadings} existing eGauge reading(s) in the refreshed window for ${currentSite.name}`);
        }
      }

      const savedReadings = await storage.upsertReadings(readings);
      console.log(`Stored ${savedReadings.length} reading(s) for ${currentSite.name} (inserted new rows or refreshed existing timestamps)`);
    }

    const cutoff = getHourlyHistoryCutoff();
    const prunedReadings = await storage.pruneReadingsBefore(currentSite.id, cutoff);
    if (prunedReadings > 0) {
      console.log(`Pruned ${prunedReadings} reading(s) older than ${cutoff.toISOString()} for ${currentSite.name}`);
    }

    await storage.updateSite(currentSite.id, { 
      status: "idle", 
      lastSyncedAt: new Date(),
      lastError: null
    });

    return { success: true, readingsCount: readings.length };

  } catch (error: any) {
    console.error(`Scrape failed for site ${currentSite.id}:`, error);
    await storage.updateSite(currentSite.id, { 
      status: "error", 
      lastError: error.message || "Unknown error" 
    });
    return { success: false, error: error.message };
  }
}

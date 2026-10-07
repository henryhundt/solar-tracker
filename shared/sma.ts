import { z } from "zod";

export const SMA_PORTAL_URL = "https://ennexos.sunnyportal.com/";
export const smaSiteIdSchema = z.string().trim().regex(/^[1-9]\d*$/, "Enter the numeric SMA system ID from the portal URL.");
export const SMA_SITE_HELP = "Enter the numeric system ID from ennexos.sunnyportal.com/<system ID>/dashboard. Uses daily production totals and SMA ID credentials; no API key required. Set the timezone to match the SMA system.";

export function validateSmaSite(site: { scraperType?: string; siteIdentifier?: string | null }): void {
  if (site.scraperType === "sma_browser") {
    z.object({ siteIdentifier: smaSiteIdSchema }).parse(site);
  }
}

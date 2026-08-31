import type { Express, Request } from "express";
import type { Server } from "http";
import { buildAlsoEnergyProviderConfig, getPreferredAlsoEnergySiteIdentifier } from "@shared/alsoenergy";
import type { PublicSite, Site, UpdateSiteRequest } from "@shared/schema";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import {
  authenticateAdmin,
  destroyAuthenticatedSession,
  getAuthSessionResponse,
  isAuthEnabled,
  requireAppAuth,
  saveAuthenticatedSession,
} from "./auth";
import { scrapeClaimedSite } from "./scraper";
import { discoverAlsoEnergyBrowserSites } from "./scrapers/alsoenergy-browser";
import { discoverAlsoEnergySites } from "./scrapers/alsoenergy";
import { discoverSolarEdgeApiSites } from "./scrapers/solaredge-api";
import { discoverSolarEdgeBrowserSites } from "./scrapers/solaredge-browser";
import { inspectEGaugeRegisters, resolveEGaugeAccess } from "./scrapers/egauge-client";
import { startScheduler, startSyncAllSites, syncAllSites } from "./scheduler";
import { trackBackgroundTask } from "./sync-runtime";
import { pool } from "./db";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const SOLAREDGE_PORTAL_URL = "https://monitoring.solaredge.com";
  const DEFAULT_READINGS_LOOKBACK_MONTHS = 24;
  const DEFAULT_READINGS_LIST_LIMIT = 5000;
  const MAX_READINGS_LIST_LIMIT = 10000;
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many login attempts. Try again later." },
  });

  const resetCount = await storage.resetStaleScrapingSites();
  if (resetCount > 0) {
    console.log(`Reset ${resetCount} site(s) left in scraping state from a previous run.`);
  }

  app.get("/healthz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      return res.json({ ok: true, database: "connected" });
    } catch (error) {
      console.error("Health check database query failed:", error);
      return res.status(503).json({ ok: false, database: "unavailable" });
    }
  });

  app.get(api.auth.session.path, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getAuthSessionResponse(req));
  });

  app.post(api.auth.login.path, loginLimiter, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { username, password } = api.auth.login.input.parse(req.body);

      if (!isAuthEnabled()) {
        return res.status(400).json({ message: "App auth is disabled in this environment." });
      }

      if (!authenticateAdmin(username, password)) {
        return res.status(401).json({ message: "Invalid username or password." });
      }

      await saveAuthenticatedSession(req);
      return res.json(getAuthSessionResponse(req));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }

      throw err;
    }
  });

  app.post(api.auth.logout.path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.session.isAuthenticated) {
      await destroyAuthenticatedSession(req);
    }

    res.json({
      authEnabled: isAuthEnabled(),
      authenticated: false,
    });
  });

  app.post("/api/internal/sync-all", async (req, res) => {
    if (!isAuthorizedCronRequest(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const syncTask = syncAllSites();
    trackBackgroundTask(syncTask, "Externally triggered full sync");
    const run = await syncTask;
    if (!run.started) {
      return res.status(409).json({ message: "A full sync is already running", success: false });
    }

    const status = run.summary.failed > 0 || run.summary.skipped > 0 ? 502 : 200;
    return res.status(status).json({
      message: status === 200 ? "Full sync completed" : "Full sync completed with site failures or skips",
      success: status === 200,
      summary: run.summary,
    });
  });

  app.use("/api", requireAppAuth);

  // Sites Routes
  app.get(api.sites.list.path, async (req, res) => {
    const input = api.sites.list.input?.parse(req.query);
    const sites = await storage.getSites({
      includeArchived: input?.includeArchived ?? false,
    });
    res.json(sites.map(serializeSite));
  });

  app.get(api.sites.get.path, async (req, res) => {
    const site = await storage.getSite(Number(req.params.id));
    if (!site) return res.status(404).json({ message: "Site not found" });
    res.json(serializeSite(site));
  });

  app.post(api.sites.create.path, async (req, res) => {
    try {
      const input = api.sites.create.input.parse(req.body);
      const site = await storage.createSite(input);
      res.status(201).json(serializeSite(site));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.put(api.sites.update.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.sites.update.input.parse(req.body);
      
      const existing = await storage.getSite(id);
      if (!existing) return res.status(404).json({ message: "Site not found" });

      const mergedInput = mergeSiteUpdate(existing, input);
      const updated = await storage.updateSite(id, mergedInput);
      res.json(serializeSite(updated));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.sites.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getSite(id);
    if (!existing) return res.status(404).json({ message: "Site not found" });
    if (existing.status === "scraping") {
      return res.status(409).json({ message: "Wait for the current sync to finish before deleting this site." });
    }
    
    await storage.deleteSite(id);
    res.status(204).send();
  });

  app.post(api.sites.archive.path, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getSite(id);
    if (!existing) return res.status(404).json({ message: "Site not found" });
    if (existing.status === "scraping") {
      return res.status(409).json({ message: "Wait for the current sync to finish before archiving this site." });
    }
    if (existing.archivedAt) {
      return res.json(serializeSite(existing));
    }

    const archived = await storage.archiveSite(id);
    res.json(serializeSite(archived));
  });

  app.post(api.sites.restore.path, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getSite(id);
    if (!existing) return res.status(404).json({ message: "Site not found" });
    if (!existing.archivedAt) {
      return res.json(serializeSite(existing));
    }

    const restored = await storage.restoreSite(id);
    res.json(serializeSite(restored));
  });

  // Scraping Route
  app.post(api.sites.scrape.path, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getSite(id);
    if (!existing) return res.status(404).json({ message: "Site not found" });
    if (existing.archivedAt) {
      return res.status(409).json({ message: "Restore this archived site before syncing it.", success: false });
    }

    const claimed = await storage.claimSiteForScrape(id);
    if (!claimed) {
      return res.status(409).json({ message: "This site is already syncing", success: false });
    }

    runSiteScrapeInBackground(claimed);

    res.status(202).json({ message: "Sync started", success: true });
  });

  // Readings Route
  app.get(api.readings.summary.path, async (req, res) => {
    try {
      const from = parseOptionalDateParam(req.query.from, "from");
      const summary = await storage.getDashboardSummary(from ?? new Date(0));

      res.json({
        dailyEnergy: summary.dailyEnergy.map((point) => ({
          siteId: point.siteId,
          date: point.date,
          energyWh: point.energyWh,
        })),
      });
    } catch (err) {
      if (err instanceof RequestValidationError) {
        return res.status(400).json({ message: err.message });
      }

      res.status(500).json({ message: "Failed to fetch dashboard summary" });
    }
  });

  app.get(api.readings.list.path, async (req, res) => {
    try {
      const input = api.readings.list.input?.parse(req.query);
      const from = parseOptionalDateParam(input?.from, "from") ?? getDefaultReadingsFromDate(DEFAULT_READINGS_LOOKBACK_MONTHS);
      const to = parseOptionalDateParam(input?.to, "to");
      const limit = Math.min(input?.limit ?? DEFAULT_READINGS_LIST_LIMIT, MAX_READINGS_LIST_LIMIT);

      const readings = await storage.getReadings(input?.siteId, from, to, "desc", { limit });
      res.json(readings.map(serializeReading));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      if (err instanceof RequestValidationError) {
        return res.status(400).json({ message: err.message });
      }

      res.status(500).json({ message: "Failed to fetch readings" });
    }
  });

  app.get(api.readings.export.path, async (req, res) => {
    try {
      const siteId = req.query.siteId ? Number(req.query.siteId) : undefined;
      const from = parseOptionalDateParam(req.query.from, "from") ?? getDefaultReadingsFromDate(DEFAULT_READINGS_LOOKBACK_MONTHS);
      const to = parseOptionalDateParam(req.query.to, "to");

      const [sites, readings] = await Promise.all([
        storage.getSites({ includeArchived: true }),
        storage.getReadings(siteId, from, to, "asc"),
      ]);

      const exportableReadings = readings.filter((reading) => reading.energyWh > 0);
      const sitesById = new Map(sites.map((site) => [site.id, site]));
      const csvRows = [
        [
          "siteId",
          "siteName",
          "scraperType",
          "timestamp",
          "energyKWh",
          "acCapacityKw",
          "dcCapacityKw",
          "notes",
        ],
        ...exportableReadings.map((reading) => {
          const site = sitesById.get(reading.siteId);
          return [
            String(reading.siteId),
            site?.name ?? "",
            site?.scraperType ?? "",
            new Date(reading.timestamp).toISOString(),
            formatEnergyKWh(reading.energyWh),
            site?.acCapacityKw == null ? "" : String(site.acCapacityKw),
            site?.dcCapacityKw == null ? "" : String(site.dcCapacityKw),
            site?.notes ?? "",
          ];
        }),
      ];

      const csv = `\uFEFF${csvRows.map((row) => row.map(formatCsvCell).join(",")).join("\n")}`;
      const fileLabel = siteId ? `site-${siteId}` : "all-sites";
      const dateLabel = new Date().toISOString().slice(0, 10);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"solar-readings-${fileLabel}-${dateLabel}.csv\"`);
      res.send(csv);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        return res.status(400).json({ message: err.message });
      }

      res.status(500).json({ message: "Failed to export readings" });
    }
  });

  const discoverSchema = z.object({
    siteId: z.coerce.number().int().positive().optional(),
    username: z.string().optional().default(""),
    password: z.string().optional().default(""),
    credentialKey: z.string().optional().default(""),
    url: z.string().optional().default(""),
  });

  app.post("/api/alsoenergy/discover", async (req, res) => {
    try {
      const { siteId, username, password, credentialKey, url } = discoverSchema.parse(req.body);
      const existingSite = await loadSiteForCredentialFallback(siteId);

      const finalUsername = resolveScopedSecret(credentialKey, "USERNAME", username || existingSite?.username || "");
      const finalPassword = resolveScopedSecret(credentialKey, "PASSWORD", password || existingSite?.password || "");
      const finalUrl = resolveScopedSecret(credentialKey, "URL", url || existingSite?.url || "");

      if (!finalUsername || !finalPassword) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const browserSites = await discoverAlsoEnergyBrowserSites(finalUsername, finalPassword);
      const apiSites = await discoverAlsoEnergySites(finalUsername, finalPassword, finalUrl || undefined).catch((error) => {
        console.log(`[AlsoEnergy] API discovery unavailable, continuing with browser-only discovery: ${error.message}`);
        return [];
      });

      const apiSitesByName = new Map(
        apiSites.map((site) => [site.siteName.trim().toLowerCase(), String(site.siteId)])
      );

      const sites = browserSites.map((site) => ({
        siteId: site.siteId,
        siteName: site.siteName,
        apiSiteId: apiSitesByName.get(site.siteName.trim().toLowerCase()) ?? null,
      }));

      res.json({ sites });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("[AlsoEnergy] Discovery error:", error);
      res.status(500).json({ message: error.message || "Failed to discover sites" });
    }
  });

  const bulkAddSchema = z.object({
    username: z.string().optional().default(""),
    password: z.string().optional().default(""),
    credentialKey: z.string().optional().default(""),
    url: z.string().optional().default(""),
    sites: z.array(z.object({
      siteId: z.union([z.string(), z.number()]).transform(v => String(v)),
      siteName: z.string(),
      apiSiteId: z.union([z.string(), z.number()]).transform(v => String(v)).nullable().optional(),
    })),
  });

  app.post("/api/alsoenergy/bulk-add", async (req, res) => {
    try {
      const { username, password, credentialKey, url, sites } = bulkAddSchema.parse(req.body);

      if (sites.length === 0) {
        return res.status(400).json({ message: "No sites selected" });
      }

      const created = [];
      for (const site of sites) {
        const providerConfig = buildAlsoEnergyProviderConfig({
          browserSiteKey: String(site.siteId),
          apiSiteId: site.apiSiteId,
        });
        const siteData: any = {
          name: site.siteName,
          url: url || "",
          scraperType: "alsoenergy",
          siteIdentifier: getPreferredAlsoEnergySiteIdentifier({
            siteIdentifier: String(site.siteId),
            providerConfig,
          }),
          username: credentialKey ? "" : username,
          password: credentialKey ? "" : password,
          credentialKey: credentialKey || "",
          apiKey: "",
          providerConfig,
        };
        const newSite = await storage.createSite(siteData);
        created.push(newSite);
      }

      res.status(201).json({ created: created.map(serializeSite), count: created.length });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("[AlsoEnergy] Bulk add error:", error);
      res.status(500).json({ message: error.message || "Failed to add sites" });
    }
  });

  const solarEdgeDiscoverSchema = z.object({
    siteId: z.coerce.number().int().positive().optional(),
    scraperType: z.enum(["solaredge_api", "solaredge_browser"]),
    username: z.string().optional().default(""),
    password: z.string().optional().default(""),
    credentialKey: z.string().optional().default(""),
    apiKey: z.string().optional().default(""),
  });

  app.post("/api/solaredge/discover", async (req, res) => {
    try {
      const { siteId, scraperType, username, password, credentialKey, apiKey } = solarEdgeDiscoverSchema.parse(req.body);
      const existingSite = await loadSiteForCredentialFallback(siteId);

      const finalUsername = resolveScopedSecret(credentialKey, "USERNAME", username || existingSite?.username || "");
      const finalPassword = resolveScopedSecret(credentialKey, "PASSWORD", password || existingSite?.password || "");
      const finalApiKey = resolveScopedSecret(credentialKey, "API_KEY", apiKey || existingSite?.apiKey || "");

      if (scraperType === "solaredge_api" && !finalApiKey) {
        return res.status(400).json({ message: "API key is required" });
      }

      if (scraperType === "solaredge_browser" && (!finalUsername || !finalPassword)) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const sites = scraperType === "solaredge_api"
        ? await discoverSolarEdgeApiSites(finalApiKey)
        : await discoverSolarEdgeBrowserSites(finalUsername, finalPassword);

      res.json({ sites });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("[SolarEdge] Discovery error:", error);
      res.status(500).json({ message: error.message || "Failed to discover sites" });
    }
  });

  const solarEdgeBulkAddSchema = solarEdgeDiscoverSchema.extend({
    sites: z.array(z.object({
      siteId: z.union([z.string(), z.number()]).transform((value) => String(value)),
      siteName: z.string(),
    })),
  });

  app.post("/api/solaredge/bulk-add", async (req, res) => {
    try {
      const { scraperType, username, password, credentialKey, apiKey, sites } = solarEdgeBulkAddSchema.parse(req.body);

      if (sites.length === 0) {
        return res.status(400).json({ message: "No sites selected" });
      }

      if (scraperType === "solaredge_api" && !credentialKey && !apiKey.trim()) {
        return res.status(400).json({ message: "API key is required for SolarEdge API sites" });
      }

      if (scraperType === "solaredge_browser" && !credentialKey && (!username.trim() || !password.trim())) {
        return res.status(400).json({ message: "Username and password are required for SolarEdge browser sites" });
      }

      const created = [];
      for (const site of sites) {
        const siteData: any = {
          name: site.siteName,
          url: SOLAREDGE_PORTAL_URL,
          scraperType,
          siteIdentifier: site.siteId,
          username: scraperType === "solaredge_browser" && !credentialKey ? username : "",
          password: scraperType === "solaredge_browser" && !credentialKey ? password : "",
          credentialKey: credentialKey || "",
          apiKey: scraperType === "solaredge_api" && !credentialKey ? apiKey : "",
          providerConfig: null,
        };

        const newSite = await storage.createSite(siteData);
        created.push(newSite);
      }

      res.status(201).json({ created: created.map(serializeSite), count: created.length });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("[SolarEdge] Bulk add error:", error);
      res.status(500).json({ message: error.message || "Failed to add sites" });
    }
  });

  const egaugeTestSchema = z.object({
    siteId: z.coerce.number().int().positive().optional(),
    url: z.string().optional().default(""),
    username: z.string().optional().default(""),
    password: z.string().optional().default(""),
    credentialKey: z.string().optional().default(""),
  });

  app.post("/api/egauge/test", async (req, res) => {
    try {
      const { siteId, url, username, password, credentialKey } = egaugeTestSchema.parse(req.body);
      const existingSite = await loadSiteForCredentialFallback(siteId);
      const access = resolveEGaugeAccess({
        url: url || existingSite?.url || "",
        username: resolveScopedSecret(credentialKey, "USERNAME", username || existingSite?.username || ""),
        password: resolveScopedSecret(credentialKey, "PASSWORD", password || existingSite?.password || ""),
        credentialKey,
      });
      const registers = await inspectEGaugeRegisters(access);

      return res.json({ success: true, registers });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: err.errors[0].message });
      }

      const message = err?.message || "Unexpected error";
      return res.json({ success: false, error: message });
    }
  });

  // Manual trigger for syncing all sites
  app.post(api.sites.syncAll.path, async (req, res) => {
    const run = await startSyncAllSites();
    if (!run.started) {
      return res.status(409).json({ message: "A full sync is already running", success: false });
    }

    trackBackgroundTask(run.completion, "Manual full sync");
    return res.status(202).json({ message: "Full sync started", success: true });
  });

  // Seed Data function
  await seedDatabase();

  // Start the daily scheduler
  startScheduler();

  return httpServer;
}

function resolveScopedSecret(credentialKey: string, suffix: string, fallback: string): string {
  if (!credentialKey) {
    return fallback;
  }

  return process.env[`${credentialKey}_${suffix}`] || fallback;
}

class RequestValidationError extends Error {}

function parseOptionalDateParam(value: unknown, label: string): Date | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new RequestValidationError(`${label} must be a valid date.`);
  }

  return parsed;
}

function getDefaultReadingsFromDate(months: number): Date {
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  from.setHours(0, 0, 0, 0);
  return from;
}

async function loadSiteForCredentialFallback(siteId?: number): Promise<Site | undefined> {
  if (!siteId) {
    return undefined;
  }

  return storage.getSite(siteId);
}

function mergeSiteUpdate(existing: Site, input: UpdateSiteRequest): UpdateSiteRequest {
  const updates: UpdateSiteRequest = { ...input };
  const nextScraperType = input.scraperType ?? existing.scraperType;
  const nextCredentialKey =
    typeof input.credentialKey === "string" ? input.credentialKey.trim() : (existing.credentialKey ?? "");

  if (nextCredentialKey) {
    updates.username = "";
    updates.password = "";
    updates.apiKey = "";
    return updates;
  }

  updates.credentialKey = "";

  if (nextScraperType === "solaredge_api") {
    clearBlankSecret(updates, "apiKey");
    updates.username = "";
    updates.password = "";
    return updates;
  }

  if (nextScraperType === "egauge" || nextScraperType === "alsoenergy" || nextScraperType === "solaredge_browser") {
    clearBlankSecret(updates, "username");
    clearBlankSecret(updates, "password");
    updates.apiKey = "";
    return updates;
  }

  updates.username = "";
  updates.password = "";
  updates.apiKey = "";
  return updates;
}

function clearBlankSecret(updates: UpdateSiteRequest, key: "username" | "password" | "apiKey") {
  if (updates[key] === undefined || updates[key] === "") {
    delete updates[key];
  }
}

function runSiteScrapeInBackground(site: Site) {
  const task = scrapeClaimedSite(site)
    .then((result) => {
      if (!result.success && !result.skipped) {
        console.error(`Background sync failed for site ${site.id}: ${result.error || "Unknown error"}`);
      }
    })
    .catch(async (error: any) => {
      console.error(`Background sync crashed for site ${site.id}:`, error);
      try {
        await storage.updateSite(site.id, {
          status: "error",
          syncStartedAt: null,
          lastError: error?.message || "Unknown sync error",
        });
      } catch (updateError) {
        console.error(`Failed to mark site ${site.id} as errored after sync crash:`, updateError);
      }
    });

  trackBackgroundTask(task, `Background sync for site ${site.id}`);
}

function serializeSite(site: Site): PublicSite {
  const { username, password, apiKey, ...publicFields } = site;

  return {
    ...publicFields,
    hasDirectCredentials: Boolean((username && username.trim()) || (password && password.trim())),
    hasDirectApiKey: Boolean(apiKey && apiKey.trim()),
  };
}

async function seedDatabase() {
  if (!shouldSeedDatabase()) {
    console.log("Skipping seed data");
    return;
  }

  const existingSites = await storage.getSites({ includeArchived: true });
  if (existingSites.length === 0) {
    console.log("Seeding database...");
    
    const site = await storage.createSite({
      name: "Home Solar Array",
      url: "https://portal.example.com",
      scraperType: "mock",
      username: "demo_user",
      password: "demo_password"
    });

    // Generate last 30 days of data
    const readings = [];
    const now = new Date();
    for (let d = 30; d >= 0; d--) {
      // For each day, generate hourly readings (daytime only)
      for (let h = 6; h <= 20; h++) {
        const timestamp = new Date(now);
        timestamp.setDate(timestamp.getDate() - d);
        timestamp.setHours(h, 0, 0, 0);

        // Simple solar curve
        const peak = 4500 + Math.random() * 1000; // 4.5-5.5kW peak
        const powerW = Math.max(0, Math.sin((h - 6) / 14 * Math.PI) * peak);
        
        // Energy Wh for that hour (approx)
        const energyWh = powerW; 

        readings.push({
          siteId: site.id,
          timestamp,
          powerW: Math.round(powerW),
          energyWh: Math.round(energyWh)
        });
      }
    }
    await storage.addReadings(readings);
    console.log("Seeding complete.");
  }
}

function isAuthorizedCronRequest(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  return req.get("authorization") === `Bearer ${cronSecret}`;
}

function shouldSeedDatabase(): boolean {
  if (process.env.SEED_ON_BOOT === "true") {
    return true;
  }

  if (process.env.SEED_ON_BOOT === "false") {
    return false;
  }

  return process.env.NODE_ENV !== "production";
}

function formatCsvCell(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}

function formatEnergyKWh(energyWh: number): string {
  return (energyWh / 1000).toFixed(3);
}

function serializeReading<T extends { powerW: number | null }>(reading: T): T {
  return {
    ...reading,
    powerW: null,
  };
}

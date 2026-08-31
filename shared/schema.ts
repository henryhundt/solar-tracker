import { index, pgTable, text, serial, integer, timestamp, real, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const SCRAPER_TYPES = [
  "solaredge_api",
  "solaredge_browser",
  "egauge",
  "alsoenergy",
  "mock",
] as const;

export const SITE_STATUSES = ["idle", "scraping", "error"] as const;

export const scraperTypeSchema = z.enum(SCRAPER_TYPES);
export const siteStatusSchema = z.enum(SITE_STATUSES);

export type ScraperType = z.infer<typeof scraperTypeSchema>;
export type SiteStatus = z.infer<typeof siteStatusSchema>;

// Stores configuration for each solar portal
// Scraper types:
// - 'solaredge_api': SolarEdge REST API (needs apiKey + siteIdentifier as numeric Site ID)
// - 'solaredge_browser': SolarEdge browser automation (needs username/password + siteIdentifier as site name)
// - 'egauge': eGauge device URL (JSON WebAPI with optional username/password, plus legacy XML fallback)
// - 'alsoenergy': Also Energy PowerTrack (numeric API site ID for REST API, or S-prefixed PowerTrack key for browser automation)
// - 'mock': Mock data for testing
export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "Home Roof"
  url: text("url").notNull(),   // Portal/Device URL
  timezone: text("timezone").notNull().default("America/Chicago"),
  acCapacityKw: real("ac_capacity_kw"),
  dcCapacityKw: real("dc_capacity_kw"),
  notes: text("notes"),
  username: text("username"),
  password: text("password"),   // Stored as text for MVP - purely for your local use
  apiKey: text("api_key"),      // API key for services that require it (SolarEdge API, Also Energy)
  credentialKey: text("credential_key"), // Map to Replit Secret key prefix (e.g. "SOLAR_PORTAL_1")
  siteIdentifier: text("site_identifier"), // Portal-specific identifier:
                                           // - SolarEdge API: numeric Site ID (e.g. "1234567")
                                           // - SolarEdge Browser: exact site name from dashboard
                                           // - Also Energy: preferred display identifier, usually the PowerTrack key (e.g. "S41121")
                                           // - eGauge: legacy register name fallback (deprecated)
  providerConfig: jsonb("provider_config"),
  scraperType: text("scraper_type").$type<ScraperType>().notNull().default("mock"), // See types above
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
  status: text("status").$type<SiteStatus>().notNull().default("idle"),
  lastError: text("last_error"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// Stores the actual production data
export const readings = pgTable("readings", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(), // When the reading was taken/applies to
  energyWh: real("energy_wh").notNull(),       // Watt-hours produced (accumulated or daily total)
  powerW: real("power_w"),                     // Current power output in Watts (optional, for real-time)
}, (table) => ({
  siteTimestampUnique: uniqueIndex("readings_site_timestamp_unique").on(table.siteId, table.timestamp),
  timestampIndex: index("readings_timestamp_idx").on(table.timestamp),
}));

export const syncLeases = pgTable("sync_leases", {
  name: text("name").primaryKey(),
  ownerId: text("owner_id").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  expiresAtIndex: index("sync_leases_expires_at_idx").on(table.expiresAt),
}));

// === SCHEMAS ===

export const insertSiteSchema = createInsertSchema(sites, {
  name: z.string().trim().min(1, "Site name is required").max(200),
  url: z.string().trim().max(2048),
  timezone: z.string().trim().min(1).max(100).refine(isValidTimeZone, "Timezone must be a valid IANA timezone").optional(),
  scraperType: scraperTypeSchema,
  credentialKey: z.string().trim().max(100).regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Credential key must contain only uppercase letters, numbers, and underscores",
  ).optional().nullable().or(z.literal("")),
}).omit({
  id: true, 
  lastSyncedAt: true, 
  syncStartedAt: true,
  status: true, 
  lastError: true,
  archivedAt: true,
});

export const insertReadingSchema = createInsertSchema(readings).omit({ id: true });

// === EXPLICIT TYPES ===

export type Site = typeof sites.$inferSelect;
export type InsertSite = z.infer<typeof insertSiteSchema>;

export type PublicSite = Omit<Site, "username" | "password" | "apiKey"> & {
  hasDirectCredentials: boolean;
  hasDirectApiKey: boolean;
};

export type Reading = typeof readings.$inferSelect;
export type InsertReading = z.infer<typeof insertReadingSchema>;

// API Types
export type CreateSiteRequest = InsertSite;
export type UpdateSiteRequest = Partial<InsertSite>;

export type SiteWithReadings = Site & {
  recentReadings?: Reading[];
};

export interface AuthSessionResponse {
  authEnabled: boolean;
  authenticated: boolean;
  username?: string;
}

export interface DashboardDailyEnergyPoint {
  siteId: number;
  date: string;
  energyWh: number;
}

export interface DashboardSummaryResponse {
  dailyEnergy: DashboardDailyEnergyPoint[];
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

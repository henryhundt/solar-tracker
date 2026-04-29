import { pgTable, text, serial, integer, timestamp, real, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

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
  scraperType: text("scraper_type").notNull().default("mock"), // See types above
  lastSyncedAt: timestamp("last_synced_at"),
  status: text("status").notNull().default("idle"), // 'idle', 'scraping', 'error'
  lastError: text("last_error"),
  archivedAt: timestamp("archived_at"),
});

// Stores the actual production data
export const readings = pgTable("readings", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").notNull(),
  timestamp: timestamp("timestamp").notNull(), // When the reading was taken/applies to
  energyWh: real("energy_wh").notNull(),       // Watt-hours produced (accumulated or daily total)
  powerW: real("power_w"),                     // Current power output in Watts (optional, for real-time)
}, (table) => ({
  siteTimestampUnique: uniqueIndex("readings_site_timestamp_unique").on(table.siteId, table.timestamp),
}));

// === SCHEMAS ===

export const insertSiteSchema = createInsertSchema(sites).omit({ 
  id: true, 
  lastSyncedAt: true, 
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
export type UpdateSiteRequest = Partial<Site>;

export type SiteWithReadings = Site & {
  recentReadings?: Reading[];
};

export interface AuthSessionResponse {
  authEnabled: boolean;
  authenticated: boolean;
  username?: string;
}

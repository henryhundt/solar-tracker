import { db } from "./db";
import {
  sites,
  readings,
  type Site,
  type InsertSite,
  type UpdateSiteRequest,
  type Reading,
  type InsertReading
} from "@shared/schema";
import { eq, desc, asc, and, gte, lte, lt, sql, isNull, isNotNull } from "drizzle-orm";

export interface SiteFilters {
  includeArchived?: boolean;
  archivedOnly?: boolean;
}

export interface ReadingFilters {
  includeArchivedSites?: boolean;
}

export interface ReadingBounds {
  earliest: Date | null;
  latest: Date | null;
  count: number;
}

export interface IStorage {
  // Sites
  getSites(filters?: SiteFilters): Promise<Site[]>;
  getSite(id: number): Promise<Site | undefined>;
  createSite(site: InsertSite): Promise<Site>;
  updateSite(id: number, updates: UpdateSiteRequest): Promise<Site>;
  archiveSite(id: number): Promise<Site>;
  restoreSite(id: number): Promise<Site>;
  deleteSite(id: number): Promise<void>;

  // Readings
  getReadings(
    siteId?: number,
    from?: Date,
    to?: Date,
    sortOrder?: "asc" | "desc",
    filters?: ReadingFilters,
  ): Promise<Reading[]>;
  addReadings(readings: InsertReading[]): Promise<Reading[]>;
  upsertReadings(readings: InsertReading[]): Promise<Reading[]>;
  getLastReading(siteId: number): Promise<Reading | undefined>;
  getReadingBounds(siteId: number): Promise<ReadingBounds>;
  pruneReadingsBefore(siteId: number, cutoff: Date): Promise<number>;
  deleteReadingsInRange(siteId: number, from: Date, to: Date): Promise<number>;
  resetStaleScrapingSites(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getSites(filters: SiteFilters = {}): Promise<Site[]> {
    const conditions = [];

    if (filters.archivedOnly) {
      conditions.push(isNotNull(sites.archivedAt));
    } else if (!filters.includeArchived) {
      conditions.push(isNull(sites.archivedAt));
    }

    let query = db.select().from(sites);

    if (conditions.length > 0) {
      // @ts-ignore - complex query typing
      query = query.where(and(...conditions));
    }

    // @ts-ignore
    return await query.orderBy(asc(sites.name));
  }

  async getSite(id: number): Promise<Site | undefined> {
    const [site] = await db.select().from(sites).where(eq(sites.id, id));
    return site;
  }

  async createSite(insertSite: InsertSite): Promise<Site> {
    const [site] = await db.insert(sites).values(insertSite).returning();
    return site;
  }

  async updateSite(id: number, updates: UpdateSiteRequest): Promise<Site> {
    const [updated] = await db.update(sites)
      .set(updates)
      .where(eq(sites.id, id))
      .returning();
    return updated;
  }

  async archiveSite(id: number): Promise<Site> {
    return this.updateSite(id, {
      archivedAt: new Date(),
      status: "idle",
      lastError: null,
    });
  }

  async restoreSite(id: number): Promise<Site> {
    return this.updateSite(id, {
      archivedAt: null,
    });
  }

  async deleteSite(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(readings).where(eq(readings.siteId, id));
      await tx.delete(sites).where(eq(sites.id, id));
    });
  }

  async getReadings(
    siteId?: number,
    from?: Date,
    to?: Date,
    sortOrder: "asc" | "desc" = "desc",
    filters: ReadingFilters = {},
  ): Promise<Reading[]> {
    let query = db.select({
      id: readings.id,
      siteId: readings.siteId,
      timestamp: readings.timestamp,
      energyWh: readings.energyWh,
      powerW: readings.powerW,
    })
      .from(readings)
      .innerJoin(sites, eq(readings.siteId, sites.id));
    
    const conditions = [];
    if (siteId) conditions.push(eq(readings.siteId, siteId));
    if (from) conditions.push(gte(readings.timestamp, from));
    if (to) conditions.push(lte(readings.timestamp, to));
    if (!siteId && !filters.includeArchivedSites) conditions.push(isNull(sites.archivedAt));

    if (conditions.length > 0) {
      // @ts-ignore - complex query typing
      query = query.where(and(...conditions));
    }

    // @ts-ignore
    return await query.orderBy(sortOrder === "asc" ? asc(readings.timestamp) : desc(readings.timestamp));
  }

  async addReadings(newReadings: InsertReading[]): Promise<Reading[]> {
    if (newReadings.length === 0) return [];
    return await db.insert(readings).values(newReadings).returning();
  }

  async upsertReadings(newReadings: InsertReading[]): Promise<Reading[]> {
    if (newReadings.length === 0) return [];

    return await db.insert(readings)
      .values(newReadings)
      .onConflictDoUpdate({
        target: [readings.siteId, readings.timestamp],
        set: {
          energyWh: sql`excluded.energy_wh`,
          powerW: sql`excluded.power_w`,
        },
      })
      .returning();
  }

  async getLastReading(siteId: number): Promise<Reading | undefined> {
    const [reading] = await db.select().from(readings)
      .where(eq(readings.siteId, siteId))
      .orderBy(desc(readings.timestamp))
      .limit(1);
    return reading;
  }

  async getReadingBounds(siteId: number): Promise<ReadingBounds> {
    const [result] = await db
      .select({
        earliest: sql<Date | null>`min(${readings.timestamp})`,
        latest: sql<Date | null>`max(${readings.timestamp})`,
        count: sql<number>`count(*)::int`,
      })
      .from(readings)
      .where(eq(readings.siteId, siteId));

    return {
      earliest: toDateOrNull(result?.earliest),
      latest: toDateOrNull(result?.latest),
      count: result?.count ?? 0,
    };
  }

  async pruneReadingsBefore(siteId: number, cutoff: Date): Promise<number> {
    const deleted = await db.delete(readings)
      .where(and(
        eq(readings.siteId, siteId),
        lt(readings.timestamp, cutoff)
      ))
      .returning({ id: readings.id });

    return deleted.length;
  }

  async deleteReadingsInRange(siteId: number, from: Date, to: Date): Promise<number> {
    const deleted = await db.delete(readings)
      .where(and(
        eq(readings.siteId, siteId),
        gte(readings.timestamp, from),
        lte(readings.timestamp, to)
      ))
      .returning({ id: readings.id });

    return deleted.length;
  }

  async resetStaleScrapingSites(): Promise<number> {
    const updatedSites = await db.update(sites)
      .set({
        status: "idle",
        lastError: "Previous sync was interrupted before completion.",
      })
      .where(eq(sites.status, "scraping"))
      .returning({ id: sites.id });

    return updatedSites.length;
  }
}

export const storage = new DatabaseStorage();

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

import { db, pool } from "./db";
import {
  sites,
  readings,
  syncLeases,
  type Site,
  type InsertSite,
  type Reading,
  type InsertReading
} from "@shared/schema";
import { eq, ne, desc, asc, and, or, gte, lte, lt, sql, isNull, isNotNull } from "drizzle-orm";
import { decryptSiteCredentials, encryptSiteCredentials } from "./credentials";

export interface SiteFilters {
  includeArchived?: boolean;
  archivedOnly?: boolean;
}

export interface ReadingFilters {
  includeArchivedSites?: boolean;
  limit?: number;
}

export interface ReadingBounds {
  earliest: Date | null;
  latest: Date | null;
  count: number;
}

export interface DashboardDailyEnergyRow {
  siteId: number;
  date: string;
  energyWh: number;
}

export interface DashboardSummary {
  dailyEnergy: DashboardDailyEnergyRow[];
}

export interface ReadingReplacementResult {
  deletedCount: number;
  readings: Reading[];
}

export interface IStorage {
  // Sites
  getSites(filters?: SiteFilters): Promise<Site[]>;
  getSite(id: number): Promise<Site | undefined>;
  createSite(site: InsertSite): Promise<Site>;
  updateSite(id: number, updates: Partial<Site>): Promise<Site>;
  claimSiteForScrape(id: number, staleBefore?: Date): Promise<Site | undefined>;
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
  getDashboardSummary(from: Date): Promise<DashboardSummary>;
  addReadings(readings: InsertReading[]): Promise<Reading[]>;
  upsertReadings(readings: InsertReading[]): Promise<Reading[]>;
  replaceReadingsInRange(
    siteId: number,
    from: Date,
    to: Date,
    newReadings: InsertReading[],
  ): Promise<ReadingReplacementResult>;
  getLastReading(siteId: number): Promise<Reading | undefined>;
  getReadingBounds(siteId: number): Promise<ReadingBounds>;
  pruneReadingsBefore(siteId: number, cutoff: Date): Promise<number>;
  deleteReadingsInRange(siteId: number, from: Date, to: Date): Promise<number>;
  resetStaleScrapingSites(staleBefore?: Date): Promise<number>;

  // Cross-process job leases
  acquireSyncLease(name: string, ownerId: string, leaseMs: number): Promise<boolean>;
  renewSyncLease(name: string, ownerId: string, leaseMs: number): Promise<boolean>;
  releaseSyncLease(name: string, ownerId: string): Promise<void>;
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
    const storedSites = await query.orderBy(asc(sites.name));
    return storedSites.map(decryptSiteCredentials);
  }

  async getSite(id: number): Promise<Site | undefined> {
    const [site] = await db.select().from(sites).where(eq(sites.id, id));
    return site ? decryptSiteCredentials(site) : undefined;
  }

  async createSite(insertSite: InsertSite): Promise<Site> {
    const [site] = await db.insert(sites).values(encryptSiteCredentials(insertSite)).returning();
    return decryptSiteCredentials(site);
  }

  async updateSite(id: number, updates: Partial<Site>): Promise<Site> {
    const [updated] = await db.update(sites)
      .set(encryptSiteCredentials(updates))
      .where(eq(sites.id, id))
      .returning();
    return decryptSiteCredentials(updated);
  }

  async claimSiteForScrape(id: number, staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000)): Promise<Site | undefined> {
    const [claimed] = await db.update(sites)
      .set({
        status: "scraping",
        syncStartedAt: new Date(),
        lastError: null,
      })
      .where(and(
        eq(sites.id, id),
        isNull(sites.archivedAt),
        or(
          ne(sites.status, "scraping"),
          isNull(sites.syncStartedAt),
          lt(sites.syncStartedAt, staleBefore),
        ),
      ))
      .returning();

    return claimed ? decryptSiteCredentials(claimed) : undefined;
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
    query = query.orderBy(sortOrder === "asc" ? asc(readings.timestamp) : desc(readings.timestamp));

    if (filters.limit) {
      // @ts-ignore - Drizzle narrows query builder types after dynamic clauses.
      query = query.limit(filters.limit);
    }

    // @ts-ignore
    return await query;
  }

  async addReadings(newReadings: InsertReading[]): Promise<Reading[]> {
    if (newReadings.length === 0) return [];
    return await db.insert(readings).values(newReadings).returning();
  }

  async getDashboardSummary(from: Date): Promise<DashboardSummary> {
    const activeSiteCondition = isNull(sites.archivedAt);
    const localDay = sql`date_trunc('day', ${readings.timestamp} AT TIME ZONE ${sites.timezone})`;

    const dailyEnergy = await db.select({
      siteId: readings.siteId,
      date: sql<string>`to_char(${localDay}, 'YYYY-MM-DD')`,
      energyWh: sql<number>`sum(${readings.energyWh})::float`,
    })
      .from(readings)
      .innerJoin(sites, eq(readings.siteId, sites.id))
      .where(and(
        activeSiteCondition,
        gte(readings.timestamp, from),
      ))
      .groupBy(
        readings.siteId,
        localDay,
      )
      .orderBy(
        asc(localDay),
        asc(readings.siteId),
      );

    return {
      dailyEnergy,
    };
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

  async replaceReadingsInRange(
    siteId: number,
    from: Date,
    to: Date,
    newReadings: InsertReading[],
  ): Promise<ReadingReplacementResult> {
    return db.transaction(async (tx) => {
      const deleted = await tx.delete(readings)
        .where(and(
          eq(readings.siteId, siteId),
          gte(readings.timestamp, from),
          lte(readings.timestamp, to),
        ))
        .returning({ id: readings.id });

      if (newReadings.length === 0) {
        return { deletedCount: deleted.length, readings: [] };
      }

      const savedReadings = await tx.insert(readings)
        .values(newReadings)
        .onConflictDoUpdate({
          target: [readings.siteId, readings.timestamp],
          set: {
            energyWh: sql`excluded.energy_wh`,
            powerW: sql`excluded.power_w`,
          },
        })
        .returning();

      return {
        deletedCount: deleted.length,
        readings: savedReadings,
      };
    });
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

  async resetStaleScrapingSites(staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000)): Promise<number> {
    const updatedSites = await db.update(sites)
      .set({
        status: "idle",
        syncStartedAt: null,
        lastError: "Previous sync was interrupted before completion.",
      })
      .where(and(
        eq(sites.status, "scraping"),
        or(
          isNull(sites.syncStartedAt),
          lt(sites.syncStartedAt, staleBefore),
        ),
      ))
      .returning({ id: sites.id });

    return updatedSites.length;
  }

  async acquireSyncLease(name: string, ownerId: string, leaseMs: number): Promise<boolean> {
    const result = await pool.query<{ owner_id: string }>(
      `
        INSERT INTO sync_leases (name, owner_id, acquired_at, expires_at)
        VALUES ($1, $2, NOW(), NOW() + ($3 * INTERVAL '1 millisecond'))
        ON CONFLICT (name) DO UPDATE
          SET owner_id = EXCLUDED.owner_id,
              acquired_at = EXCLUDED.acquired_at,
              expires_at = EXCLUDED.expires_at
          WHERE sync_leases.expires_at <= NOW()
        RETURNING owner_id
      `,
      [name, ownerId, leaseMs],
    );

    return result.rows[0]?.owner_id === ownerId;
  }

  async renewSyncLease(name: string, ownerId: string, leaseMs: number): Promise<boolean> {
    const [renewed] = await db.update(syncLeases)
      .set({ expiresAt: new Date(Date.now() + leaseMs) })
      .where(and(
        eq(syncLeases.name, name),
        eq(syncLeases.ownerId, ownerId),
      ))
      .returning({ name: syncLeases.name });

    return Boolean(renewed);
  }

  async releaseSyncLease(name: string, ownerId: string): Promise<void> {
    await db.delete(syncLeases)
      .where(and(
        eq(syncLeases.name, name),
        eq(syncLeases.ownerId, ownerId),
      ));
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

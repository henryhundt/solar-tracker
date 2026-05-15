import { lazy, Suspense, useState } from "react";
import { format, formatDistanceToNow, isToday, startOfDay, subDays } from "date-fns";
import { Download, ExternalLink, LineChart, Sun, Zap } from "lucide-react";
import type { DashboardLatestReading } from "@shared/schema";
import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDashboardSummary } from "@/hooks/use-dashboard-summary";
import { useSites } from "@/hooks/use-sites";
import { getSyncHealth, siteNeedsReview } from "@/lib/site-health";
import { cn } from "@/lib/utils";

const ProductionTrendChart = lazy(() =>
  import("@/components/dashboard/ProductionTrendChart").then((module) => ({
    default: module.ProductionTrendChart,
  }))
);

const HISTORY_WINDOW_DAYS = 60;
const CURRENT_WINDOW_DAYS = 30;

interface ChartDataPoint {
  date: Date;
  label: string;
  fullLabel: string;
  energyWh: number;
  energyKwh: number;
}

function formatEnergy(energyWh: number, fractionDigits = 1) {
  return `${(energyWh / 1000).toFixed(fractionDigits)} kWh`;
}

function formatPower(powerW?: number | null) {
  if (!powerW || powerW <= 0) {
    return "No live power";
  }

  if (powerW >= 1000) {
    return `${(powerW / 1000).toFixed(1)} kW`;
  }

  return `${Math.round(powerW)} W`;
}

function parseSummaryDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function isUsableUrl(url: string) {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

function formatScraperLabel(scraperType: string) {
  const labels: Record<string, string> = {
    alsoenergy: "AlsoEnergy",
    egauge: "eGauge",
    mock: "Mock",
    solaredge_api: "SolarEdge API",
    solaredge_browser: "SolarEdge Browser",
  };

  return labels[scraperType] ?? scraperType
    .replace(/_/g, " ")
    .replace(/\bapi\b/gi, "API")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function Dashboard() {
  const { data: sites, isLoading: isLoadingSites } = useSites();
  const historyFrom = startOfDay(subDays(new Date(), HISTORY_WINDOW_DAYS - 1)).toISOString();
  const { data: dashboardSummary, isLoading: isLoadingSummary } = useDashboardSummary({ from: historyFrom });
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);

  const buildExportUrl = () => {
    const url = new URL("/api/readings/export", window.location.origin);
    if (selectedSiteId) {
      url.searchParams.set("siteId", String(selectedSiteId));
    }
    return url.toString();
  };

  const selectedSite = sites?.find((site) => site.id === selectedSiteId) ?? null;
  const dailyEnergy = dashboardSummary?.dailyEnergy ?? [];
  const filteredDailyEnergy = selectedSiteId
    ? dailyEnergy.filter((point) => point.siteId === selectedSiteId)
    : dailyEnergy;

  const now = new Date();
  const currentWindowStart = startOfDay(subDays(now, CURRENT_WINDOW_DAYS - 1));
  const previousWindowStart = startOfDay(subDays(currentWindowStart, CURRENT_WINDOW_DAYS));

  const latestReadingBySite = new Map<number, DashboardLatestReading>(
    (dashboardSummary?.latestReadings ?? []).map((reading) => [reading.siteId, reading])
  );

  const chartBuckets = new Map<string, ChartDataPoint>();
  let currentTotalWh = 0;
  let previousTotalWh = 0;
  const reportingSiteIds = new Set<number>();

  for (const point of filteredDailyEnergy) {
    const readingDate = parseSummaryDate(point.date);

    if (readingDate >= currentWindowStart) {
      currentTotalWh += point.energyWh;
      reportingSiteIds.add(point.siteId);

      const bucket = chartBuckets.get(point.date);
      if (bucket) {
        bucket.energyWh += point.energyWh;
        bucket.energyKwh = bucket.energyWh / 1000;
      } else {
        chartBuckets.set(point.date, {
          date: readingDate,
          label: format(readingDate, "MMM d"),
          fullLabel: format(readingDate, "EEEE, MMM d"),
          energyWh: point.energyWh,
          energyKwh: point.energyWh / 1000,
        });
      }
    } else if (readingDate >= previousWindowStart) {
      previousTotalWh += point.energyWh;
    }
  }

  const chartData = Array.from(chartBuckets.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const bestDay = chartData.reduce<ChartDataPoint | null>(
    (best, day) => (!best || day.energyWh > best.energyWh ? day : best),
    null
  );

  const trendPercent = previousTotalWh > 0
    ? ((currentTotalWh - previousTotalWh) / previousTotalWh) * 100
    : null;

  const averageDailyWh = chartData.length > 0 ? currentTotalWh / chartData.length : 0;
  const activeSitesCount = sites?.length ?? 0;
  const syncedTodayCount = sites?.filter((site) => site.lastSyncedAt && isToday(new Date(site.lastSyncedAt))).length ?? 0;
  const sitesNeedingAttention = sites?.filter((site) => site.status === "error").length ?? 0;
  const staleSitesCount = sites?.filter((site) => getSyncHealth(site.lastSyncedAt, now) === "stale").length ?? 0;
  const unsyncedSitesCount = sites?.filter((site) => getSyncHealth(site.lastSyncedAt, now) === "never").length ?? 0;
  const sitesRequiringReview = sites?.filter((site) => siteNeedsReview(site, now)).length ?? 0;
  const latestSiteSync = sites?.reduce<Date | null>((latest, site) => {
    if (!site.lastSyncedAt) {
      return latest;
    }

    const siteSyncDate = new Date(site.lastSyncedAt);
    if (!latest || siteSyncDate.getTime() > latest.getTime()) {
      return siteSyncDate;
    }

    return latest;
  }, null) ?? null;
  const latestSiteSyncLabel = latestSiteSync
    ? formatDistanceToNow(latestSiteSync, { addSuffix: true })
    : "No successful sync yet";

  if (isLoadingSites || isLoadingSummary) {
    return (
      <Layout>
        <div className="flex h-[80vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
            <p className="animate-pulse text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (sites?.length === 0) {
    return (
      <Layout>
        <div className="flex h-[60vh] flex-col items-center justify-center space-y-4 rounded-[2rem] border border-dashed border-border bg-card/70 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Sun className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold">No Active Sites</h2>
          <p className="max-w-xs text-muted-foreground">
            Add a solar portal or restore an archived site to monitor production data.
          </p>
          <a href="/sites">
            <Button size="lg" className="rounded-full px-6">
              Manage Sites
            </Button>
          </a>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 md:space-y-8">
        <section className="rounded-[2rem] border border-border/60 bg-card/80 p-5 shadow-sm shadow-slate-950/5 backdrop-blur-sm md:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                {selectedSite ? "Focused View" : "Portfolio Overview"}
              </div>

              <div className="space-y-2">
                <h2 className="text-3xl font-bold font-display tracking-tight text-foreground md:text-4xl">
                  {selectedSite ? selectedSite.name : "Overview"}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                  {selectedSite
                    ? "Track this system’s recent production, watch for stale syncs, and export its latest readings."
                    : "Compare recent production, keep an eye on sync freshness, and jump straight to any site that needs attention."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-border bg-background/80 px-3 py-2 text-sm text-foreground">
                  {activeSitesCount} active site{activeSitesCount === 1 ? "" : "s"}
                </span>
                <span className="rounded-full border border-border bg-background/80 px-3 py-2 text-sm text-muted-foreground">
                  Latest sync {latestSiteSyncLabel}
                </span>
                <span className="rounded-full border border-border bg-background/80 px-3 py-2 text-sm text-muted-foreground">
                  {sitesNeedingAttention > 0
                    ? `${sitesNeedingAttention} site${sitesNeedingAttention === 1 ? "" : "s"} need attention`
                    : staleSitesCount > 0
                    ? `${staleSitesCount} stale sync${staleSitesCount === 1 ? "" : "s"}`
                    : unsyncedSitesCount > 0
                    ? `${unsyncedSitesCount} site${unsyncedSitesCount === 1 ? "" : "s"} not synced yet`
                    : syncedTodayCount > 0
                    ? `${syncedTodayCount} site${syncedTodayCount === 1 ? "" : "s"} synced today`
                    : "All sites recently synced"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="rounded-full px-4">
                <a href={buildExportUrl()}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </a>
              </Button>
            </div>
          </div>

          {(sites?.length ?? 0) > 1 && (
            <div className="mt-6 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Quick Filters
              </p>
              <div className="md:hidden">
                <Select
                  value={selectedSiteId == null ? "all" : String(selectedSiteId)}
                  onValueChange={(value) => setSelectedSiteId(value === "all" ? null : Number(value))}
                >
                  <SelectTrigger className="h-11 rounded-2xl border-border/70 bg-background/90 px-4 text-left shadow-sm">
                    <SelectValue placeholder="All Sites" />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl">
                    <SelectItem value="all">All Sites</SelectItem>
                    {sites?.map((site) => (
                      <SelectItem key={site.id} value={String(site.id)}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden gap-2 overflow-x-auto pb-1 md:flex">
                <button
                  type="button"
                  onClick={() => setSelectedSiteId(null)}
                  className={cn(
                    "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    selectedSiteId === null
                      ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                      : "border-border bg-background/80 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                  )}
                  data-testid="button-clear-filter"
                >
                  All Sites
                </button>
                {sites?.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    onClick={() => setSelectedSiteId(site.id)}
                    className={cn(
                      "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                      selectedSiteId === site.id
                        ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                        : "border-border bg-background/80 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                    )}
                  >
                    {site.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <StatCard
              title="30-Day Production"
              value={formatEnergy(currentTotalWh)}
              icon={<Zap className="h-5 w-5 text-amber-500" />}
              trend={
                trendPercent === null
                  ? undefined
                  : `${trendPercent > 0 ? "+" : ""}${trendPercent.toFixed(0)}%`
              }
              trendUp={trendPercent == null ? undefined : trendPercent >= 0}
              description={
                previousTotalWh > 0
                  ? "Compared with the previous 30-day window."
                  : `${chartData.length} reporting day${chartData.length === 1 ? "" : "s"} in this view.`
              }
            />
          </div>

          <div>
            <StatCard
              title="Average Reporting Day"
              value={chartData.length > 0 ? formatEnergy(averageDailyWh) : "No data"}
              icon={<LineChart className="h-5 w-5 text-sky-500" />}
              description={
                chartData.length > 0
                  ? `${chartData.length} day${chartData.length === 1 ? "" : "s"} with readings in the last 30 days.`
                  : "Sync a site to populate this card."
              }
            />
          </div>

          <div>
            <StatCard
              title="Peak Production Day"
              value={bestDay ? formatEnergy(bestDay.energyWh) : "No data"}
              icon={<Sun className="h-5 w-5 text-orange-500" />}
              description={
                bestDay
                  ? `${bestDay.fullLabel} was the strongest production day in view.`
                  : "Peak-day insight will appear after the next successful sync."
              }
            />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
          <Suspense
            fallback={(
              <section className="rounded-[2rem] border border-border/60 bg-card/95 p-5 shadow-sm shadow-slate-950/5 md:p-6">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="h-6 w-40 animate-pulse rounded-full bg-muted/50" />
                    <div className="h-4 w-56 animate-pulse rounded-full bg-muted/40" />
                  </div>
                  <div className="h-8 w-28 animate-pulse rounded-full bg-muted/40" />
                </div>
                <div className="h-[320px] rounded-[1.5rem] bg-muted/20" />
              </section>
            )}
          >
            <ProductionTrendChart
              chartData={chartData}
              currentWindowDays={CURRENT_WINDOW_DAYS}
              reportingSiteCount={reportingSiteIds.size}
            />
          </Suspense>

          <section className="flex flex-col rounded-[2rem] border border-border/60 bg-card/95 p-5 shadow-sm shadow-slate-950/5 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Site Health</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sitesRequiringReview > 0
                    ? `${sitesRequiringReview} site${sitesRequiringReview === 1 ? "" : "s"} currently need review.`
                    : "Tap a site to focus the dashboard on it without leaving this page."}
                </p>
              </div>
              {selectedSite && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  Filtered
                </span>
              )}
            </div>

            <div className="space-y-3 overflow-y-auto pr-1">
              {sites?.map((site) => {
                const latestReading = latestReadingBySite.get(site.id);
                const portalUrl = isUsableUrl(site.url) ? site.url : null;
                const isSelected = selectedSiteId === site.id;
                const readingDate = latestReading ? new Date(latestReading.timestamp) : null;
                const latestReadingLabel = latestReading
                  ? isToday(readingDate!)
                    ? "Today"
                    : format(readingDate!, "MMM d")
                  : "Awaiting data";
                const syncLabel = site.lastSyncedAt
                  ? `Last synced ${formatDistanceToNow(new Date(site.lastSyncedAt), { addSuffix: true })}`
                  : "Never synced";

                return (
                  <div
                    key={site.id}
                    onClick={() => setSelectedSiteId(isSelected ? null : site.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedSiteId(isSelected ? null : site.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "rounded-[1.5rem] border p-4 transition-all focus:outline-none focus:ring-2 focus:ring-primary/20",
                      isSelected
                        ? "border-primary/30 bg-primary/10 shadow-sm shadow-primary/10"
                        : "border-border/70 bg-background/70 hover:border-primary/20 hover:bg-background"
                    )}
                    data-testid={`site-card-${site.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-orange-100 text-orange-700"
                        )}
                      >
                        {site.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{site.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatScraperLabel(site.scraperType)} portal
                            </p>
                          </div>

                          {portalUrl && (
                            <a
                              href={portalUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="rounded-full border border-border bg-card/80 p-2 text-muted-foreground transition-colors hover:border-primary/20 hover:text-primary"
                              title="Open portal"
                              data-testid={`link-portal-${site.id}`}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-2xl border border-border/60 bg-card/90 px-3 py-2.5">
                            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {latestReadingLabel}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                              {latestReading ? formatEnergy(latestReading.energyWh, 2) : "No reading yet"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-card/90 px-3 py-2.5">
                            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Live Output
                            </p>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                              {formatPower(latestReading?.powerW)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusBadge
                            status={site.status as "idle" | "scraping" | "error"}
                            lastError={site.lastError}
                            lastSyncedAt={site.lastSyncedAt}
                          />
                          <span className="text-xs text-muted-foreground">{syncLabel}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}

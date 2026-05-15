import { lazy, Suspense } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Archive,
  Download,
  ExternalLink,
  Hash,
  Key,
  Pencil,
  RefreshCw,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import { parseEGaugeProviderConfig } from "@shared/egauge";
import { type PublicSite } from "@shared/schema";
import { Layout } from "@/components/Layout";
import { StatusBadge } from "@/components/StatusBadge";
import { getSyncHealth, siteNeedsReview } from "@/lib/site-health";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useArchiveSite, useDeleteSite, useRestoreSite, useScrapeSite, useSites } from "@/hooks/use-sites";

const AddSiteDialog = lazy(() =>
  import("@/components/AddSiteDialog").then((module) => ({
    default: module.AddSiteDialog,
  }))
);

const EditSiteDialog = lazy(() =>
  import("@/components/EditSiteDialog").then((module) => ({
    default: module.EditSiteDialog,
  }))
);

function getSiteHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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

function getSystemSizeLabel(site: PublicSite) {
  if (site.acCapacityKw == null && site.dcCapacityKw == null) {
    return null;
  }

  return [
    site.acCapacityKw != null ? `${site.acCapacityKw} kW AC` : null,
    site.dcCapacityKw != null ? `${site.dcCapacityKw} kW DC` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatSyncRelative(timestamp?: Date | string | null) {
  if (!timestamp) {
    return "Never synced";
  }

  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

function formatSyncExact(timestamp?: Date | string | null) {
  if (!timestamp) {
    return "No sync recorded";
  }

  return format(new Date(timestamp), "MMM d, yyyy 'at' HH:mm");
}

function SummaryCard({
  icon,
  label,
  value,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <div className="rounded-[1.75rem] border border-border/60 bg-card/90 p-5 shadow-sm shadow-slate-950/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/70 bg-background/90 shadow-sm">
          {icon}
        </div>
        <div className="text-right">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-3xl font-bold font-display tracking-tight text-foreground">
            {value}
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function DetailTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 text-sm font-medium text-foreground">{value}</div>
      {caption && <p className="mt-1 text-xs leading-5 text-muted-foreground">{caption}</p>}
    </div>
  );
}

function SiteDetails({ site, archived }: { site: PublicSite; archived?: boolean }) {
  const eGaugeConfig = site.scraperType === "egauge"
    ? parseEGaugeProviderConfig(site.providerConfig)
    : null;
  const systemSize = getSystemSizeLabel(site);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {!archived && (
          <DetailTile
            label="Status"
            value={
              <StatusBadge
                status={site.status as "idle" | "scraping" | "error"}
                lastError={site.lastError}
                lastSyncedAt={site.lastSyncedAt}
              />
            }
          />
        )}

        <DetailTile
          label={archived ? "Archived On" : "Last Synced"}
          value={archived && site.archivedAt ? format(new Date(site.archivedAt), "MMM d, yyyy") : formatSyncRelative(site.lastSyncedAt)}
          caption={archived ? undefined : formatSyncExact(site.lastSyncedAt)}
        />

        <DetailTile
          label="Portal Type"
          value={formatScraperLabel(site.scraperType)}
        />

        {systemSize && (
          <DetailTile
            label="System Size"
            value={systemSize}
          />
        )}
      </div>

      {(site.siteIdentifier || site.credentialKey || (eGaugeConfig && eGaugeConfig.selectedRegisters.length > 0)) && (
        <div className="flex flex-wrap gap-2">
          {site.siteIdentifier && (
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
              <Hash className="mr-1 h-3 w-3" />
              {site.siteIdentifier}
            </Badge>
          )}

          {site.credentialKey && (
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
              <Key className="mr-1 h-3 w-3" />
              {site.credentialKey}
            </Badge>
          )}

          {eGaugeConfig && eGaugeConfig.selectedRegisters.length > 0 && (
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
              <Sun className="mr-1 h-3 w-3" />
              {eGaugeConfig.selectedRegisters.length} register{eGaugeConfig.selectedRegisters.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      )}

      {site.lastError && site.status === "error" && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {site.lastError}
        </div>
      )}

      {site.notes && (
        <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Notes
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground" data-testid={`text-site-notes-${site.id}`}>
            {site.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="col-span-full rounded-[2rem] border border-dashed border-border bg-card/60 px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Sun className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export default function Sites() {
  const { data: sites, isLoading } = useSites({ includeArchived: true });
  const archiveMutation = useArchiveSite();
  const deleteMutation = useDeleteSite();
  const restoreMutation = useRestoreSite();
  const scrapeMutation = useScrapeSite();

  const buildExportUrl = (siteId?: number) => {
    const url = new URL("/api/readings/export", window.location.origin);
    if (siteId) {
      url.searchParams.set("siteId", String(siteId));
    }
    return url.toString();
  };

  const activeSites = sites?.filter((site) => !site.archivedAt) ?? [];
  const archivedSites = (sites?.filter((site) => Boolean(site.archivedAt)) ?? [])
    .sort((a, b) => new Date(b.archivedAt || 0).getTime() - new Date(a.archivedAt || 0).getTime());
  const now = new Date();
  const sitesNeedingAttention = activeSites.filter((site) => siteNeedsReview(site, now)).length;
  const staleSitesCount = activeSites.filter((site) => getSyncHealth(site.lastSyncedAt, now) === "stale").length;
  const unsyncedSitesCount = activeSites.filter((site) => getSyncHealth(site.lastSyncedAt, now) === "never").length;

  if (isLoading) {
    return (
      <Layout>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((index) => (
            <div key={index} className="h-72 animate-pulse rounded-[2rem] bg-muted/20" />
          ))}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-border/60 bg-card/80 p-5 shadow-sm shadow-slate-950/5 backdrop-blur-sm md:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Operations
              </div>
              <div>
                <h2 className="text-3xl font-bold font-display tracking-tight text-foreground md:text-4xl">Solar Sites</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                  Manage active portals, keep archived systems on hand for exports, and make risky actions clearer before you commit them.
                </p>
              </div>
            </div>

            <Suspense
              fallback={(
                <Button className="rounded-full px-6" disabled>
                  Loading form...
                </Button>
              )}
            >
              <AddSiteDialog />
            </Suspense>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              icon={<Sun className="h-5 w-5 text-amber-500" />}
              label="Active Sites"
              value={activeSites.length}
              description="Included in dashboard totals and scheduled syncs."
            />
            <SummaryCard
              icon={<AlertCircle className="h-5 w-5 text-rose-500" />}
              label="Need Attention"
              value={sitesNeedingAttention}
              description={
                sitesNeedingAttention > 0
                  ? `${staleSitesCount} stale sync${staleSitesCount === 1 ? "" : "s"}${unsyncedSitesCount > 0 ? `, ${unsyncedSitesCount} not synced yet` : ""}.`
                  : "All active portals are currently healthy and recently synced."
              }
            />
            <SummaryCard
              icon={<Archive className="h-5 w-5 text-slate-500" />}
              label="Archived"
              value={archivedSites.length}
              description="Preserved for export and restore, but kept out of scheduled syncs."
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Active Sites</h3>
              <p className="text-sm text-muted-foreground">Included in dashboard totals and background sync jobs.</p>
            </div>
            <Badge variant="secondary" className="rounded-full px-3 py-1">
              {activeSites.length}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {activeSites.map((site) => {
              const isSyncing = site.status === "scraping" || (scrapeMutation.isPending && scrapeMutation.variables === site.id);
              const isArchiving = archiveMutation.isPending && archiveMutation.variables === site.id;
              const isDeleting = deleteMutation.isPending && deleteMutation.variables === site.id;
              const portalUrl = isUsableUrl(site.url) ? site.url : null;

              return (
                <div key={site.id}>
                  <Card className="overflow-hidden rounded-[2rem] border-border/60 bg-card/95 shadow-sm shadow-slate-950/5">
                    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-6 pb-4">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-bold font-display text-foreground">{site.name}</h3>
                          <Badge variant="secondary" className="rounded-full">
                            {formatScraperLabel(site.scraperType)}
                          </Badge>
                        </div>

                        {portalUrl ? (
                          <a
                            href={portalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
                          >
                            {getSiteHostname(site.url)}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground">Portal launches from the stored site identifier.</p>
                        )}
                      </div>

                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-base font-bold text-primary">
                        {site.name.charAt(0).toUpperCase()}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 p-6 pt-0">
                      <SiteDetails site={site} />
                    </CardContent>

                    <CardFooter className="flex flex-col gap-3 border-t border-border/50 bg-muted/10 p-4">
                      <div className="grid w-full gap-2 sm:grid-cols-3">
                        <Button
                          variant="secondary"
                          className="w-full rounded-xl"
                          onClick={() => scrapeMutation.mutate(site.id)}
                          disabled={isSyncing || isArchiving || isDeleting}
                        >
                          <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                          {isSyncing ? "Syncing..." : "Sync Now"}
                        </Button>

                        <Button asChild variant="outline" className="w-full rounded-xl">
                          <a href={buildExportUrl(site.id)}>
                            <Download className="h-4 w-4" />
                            Export CSV
                          </a>
                        </Button>

                        <Suspense
                          fallback={(
                            <Button
                              variant="outline"
                              className="w-full rounded-xl"
                              disabled
                              data-testid={`button-edit-site-${site.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                              Loading Form...
                            </Button>
                          )}
                        >
                          <EditSiteDialog
                            site={site}
                            trigger={
                              <Button
                                variant="outline"
                                className="w-full rounded-xl"
                                data-testid={`button-edit-site-${site.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                                Edit Site
                              </Button>
                            }
                          />
                        </Suspense>
                      </div>

                      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              className="rounded-xl text-amber-700 hover:bg-amber-50 hover:text-amber-700"
                              disabled={isSyncing || isArchiving || isDeleting}
                            >
                              <Archive className="h-4 w-4" />
                              Archive Site
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="rounded-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive this site?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes <strong>{site.name}</strong> from the dashboard and scheduled syncs, but keeps its stored history so you can restore or export it later.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => archiveMutation.mutate(site.id)}
                                className="rounded-xl bg-amber-500 hover:bg-amber-600"
                              >
                                Archive
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              className="rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              disabled={isSyncing || isArchiving || isDeleting}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete Site
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="rounded-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this site permanently?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will delete the configuration for <strong>{site.name}</strong> and remove all of its stored historical readings.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(site.id)}
                                className="rounded-xl bg-red-500 hover:bg-red-600"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardFooter>
                  </Card>
                </div>
              );
            })}

            {activeSites.length === 0 && archivedSites.length === 0 && (
              <EmptyState
                title="No Sites Configured"
                description="Add your first solar portal to start tracking your energy production."
              />
            )}

            {activeSites.length === 0 && archivedSites.length > 0 && (
              <EmptyState
                title="No Active Sites"
                description="All current sites are archived. Restore one below or add a new portal to resume syncing."
              />
            )}
          </div>
        </section>

        {archivedSites.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-foreground">Archived Sites</h3>
                <p className="text-sm text-muted-foreground">Historical readings are preserved here, but archived portals stay out of active syncs.</p>
              </div>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {archivedSites.length}
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {archivedSites.map((site) => {
                const isRestoring = restoreMutation.isPending && restoreMutation.variables === site.id;
                const isDeleting = deleteMutation.isPending && deleteMutation.variables === site.id;
                const portalUrl = isUsableUrl(site.url) ? site.url : null;

                return (
                  <div key={site.id}>
                    <Card className="overflow-hidden rounded-[2rem] border-border/60 bg-card/80 shadow-sm shadow-slate-950/5">
                      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-6 pb-4">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xl font-bold font-display text-foreground">{site.name}</h3>
                            <Badge variant="secondary" className="rounded-full">Archived</Badge>
                          </div>

                          {portalUrl ? (
                            <a
                              href={portalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
                            >
                              {getSiteHostname(site.url)}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <p className="text-sm text-muted-foreground">Portal URL unavailable</p>
                          )}
                        </div>

                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-base font-bold text-muted-foreground">
                          {site.name.charAt(0).toUpperCase()}
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-4 p-6 pt-0">
                        <SiteDetails site={site} archived />
                      </CardContent>

                      <CardFooter className="flex flex-col gap-3 border-t border-border/50 bg-muted/10 p-4">
                        <div className="grid w-full gap-2 sm:grid-cols-2">
                          <Button asChild variant="outline" className="w-full rounded-xl">
                            <a href={buildExportUrl(site.id)}>
                              <Download className="h-4 w-4" />
                              Export CSV
                            </a>
                          </Button>

                          <Button
                            variant="secondary"
                            className="w-full rounded-xl"
                            onClick={() => restoreMutation.mutate(site.id)}
                            disabled={isRestoring || isDeleting}
                          >
                            <RotateCcw className="h-4 w-4" />
                            {isRestoring ? "Restoring..." : "Restore Site"}
                          </Button>
                        </div>

                        <div className="flex w-full justify-end">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                className="rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                disabled={isRestoring || isDeleting}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete Permanently
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-2xl">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete archived site permanently?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will remove <strong>{site.name}</strong> and permanently erase all of its stored historical readings.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(site.id)}
                                  className="rounded-xl bg-red-500 hover:bg-red-600"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </CardFooter>
                    </Card>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}

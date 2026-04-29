import { useArchiveSite, useDeleteSite, useRestoreSite, useScrapeSite, useSites } from "@/hooks/use-sites";
import { Layout } from "@/components/Layout";
import { AddSiteDialog } from "@/components/AddSiteDialog";
import { EditSiteDialog } from "@/components/EditSiteDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { parseEGaugeProviderConfig } from "@shared/egauge";
import { type PublicSite } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Archive, CalendarClock, Download, ExternalLink, Hash, Key, RefreshCw, RotateCcw, Sun, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
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

function getSiteHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function SiteDetails({ site, archived }: { site: PublicSite; archived?: boolean }) {
  const eGaugeConfig = site.scraperType === "egauge"
    ? parseEGaugeProviderConfig(site.providerConfig)
    : null;

  return (
    <>
      {!archived && (
        <div className="flex justify-between items-center p-3 bg-muted/50 rounded-xl">
          <span className="text-sm font-medium text-muted-foreground">Status</span>
          <StatusBadge
            status={site.status as "idle" | "scraping" | "error"}
            lastError={site.lastError}
          />
        </div>
      )}

      {archived && site.archivedAt && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Archive className="w-4 h-4" /> Archived
          </span>
          <span className="font-medium text-foreground">
            {format(new Date(site.archivedAt), "MMM dd, yyyy")}
          </span>
        </div>
      )}

      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4" /> Last Synced
        </span>
        <span className="font-medium text-foreground">
          {site.lastSyncedAt
            ? format(new Date(site.lastSyncedAt), "MMM dd, HH:mm")
            : "Never"}
        </span>
      </div>

      {site.siteIdentifier && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Hash className="w-4 h-4" /> Site ID
          </span>
          <span className="font-mono text-xs bg-muted px-2 py-1 rounded-lg" data-testid={`text-site-identifier-${site.id}`}>
            {site.siteIdentifier}
          </span>
        </div>
      )}

      {site.credentialKey && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Key className="w-4 h-4" /> Credentials
          </span>
          <span className="font-mono text-xs bg-muted px-2 py-1 rounded-lg" data-testid={`text-credential-key-${site.id}`}>
            {site.credentialKey}
          </span>
        </div>
      )}

      {eGaugeConfig && eGaugeConfig.selectedRegisters.length > 0 && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Sun className="w-4 h-4" /> Registers
          </span>
          <span className="font-medium text-foreground" data-testid={`text-egauge-register-count-${site.id}`}>
            {eGaugeConfig.selectedRegisters.length} selected
          </span>
        </div>
      )}

      {(site.acCapacityKw != null || site.dcCapacityKw != null) && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">System Size</span>
          <span className="font-medium text-foreground" data-testid={`text-site-capacity-${site.id}`}>
            {site.acCapacityKw != null ? `${site.acCapacityKw} kW AC` : ""}
            {site.acCapacityKw != null && site.dcCapacityKw != null ? " / " : ""}
            {site.dcCapacityKw != null ? `${site.dcCapacityKw} kW DC` : ""}
          </span>
        </div>
      )}

      {site.notes && (
        <div className="space-y-1 text-sm">
          <span className="text-muted-foreground">Notes</span>
          <p className="text-foreground leading-5 max-h-16 overflow-hidden" data-testid={`text-site-notes-${site.id}`}>
            {site.notes}
          </p>
        </div>
      )}
    </>
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
    <div className="col-span-full py-16 text-center border-2 border-dashed border-muted rounded-3xl bg-muted/10">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
        <Sun className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-sm mx-auto">
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

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 bg-muted/20 animate-pulse rounded-2xl" />
          ))}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold font-display text-foreground tracking-tight">Solar Sites</h2>
          <p className="text-muted-foreground mt-1">
            Manage active portals, archive retired systems, or permanently delete sites and their stored data.
          </p>
        </div>
        <AddSiteDialog />
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Active Sites</h3>
            <p className="text-sm text-muted-foreground">Included in dashboard totals and scheduled syncs.</p>
          </div>
          <Badge variant="secondary" className="rounded-full px-3 py-1">
            {activeSites.length}
          </Badge>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {activeSites.map((site) => {
            const isSyncing = site.status === "scraping" || (scrapeMutation.isPending && scrapeMutation.variables === site.id);
            const isArchiving = archiveMutation.isPending && archiveMutation.variables === site.id;
            const isDeleting = deleteMutation.isPending && deleteMutation.variables === site.id;

            return (
              <motion.div key={site.id} variants={item}>
                <Card className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-all overflow-hidden group">
                  <CardHeader className="p-6 pb-4 flex flex-row items-start justify-between space-y-0">
                    <div className="space-y-1">
                      <h3 className="font-display font-bold text-lg">{site.name}</h3>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                      >
                        {getSiteHostname(site.url)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {site.name.charAt(0).toUpperCase()}
                    </div>
                  </CardHeader>

                  <CardContent className="p-6 py-4 space-y-4">
                    <SiteDetails site={site} />
                  </CardContent>

                  <CardFooter className="p-4 bg-muted/20 flex gap-2 justify-end border-t border-border/50 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-lg hover:bg-white hover:text-primary"
                      onClick={() => scrapeMutation.mutate(site.id)}
                      disabled={isSyncing || isArchiving || isDeleting}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
                      {isSyncing ? "Syncing..." : "Sync Now"}
                    </Button>

                    <Button asChild variant="ghost" size="sm" className="rounded-lg hover:bg-white hover:text-primary">
                      <a href={buildExportUrl(site.id)}>
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                      </a>
                    </Button>

                    <EditSiteDialog site={site} />

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-amber-600 hover:bg-amber-50 rounded-lg"
                          disabled={isSyncing || isArchiving || isDeleting}
                          title="Archive site"
                        >
                          <Archive className="w-4 h-4" />
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
                          size="icon"
                          className="text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg"
                          disabled={isSyncing || isArchiving || isDeleting}
                          title="Delete site permanently"
                        >
                          <Trash2 className="w-4 h-4" />
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
                            className="bg-red-500 hover:bg-red-600 rounded-xl"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardFooter>
                </Card>
              </motion.div>
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
        </motion.div>
      </section>

      {archivedSites.length > 0 && (
        <section className="space-y-4 mt-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Archived Sites</h3>
              <p className="text-sm text-muted-foreground">Historical readings are preserved here, but archived sites stay out of active syncs.</p>
            </div>
            <Badge variant="outline" className="rounded-full px-3 py-1">
              {archivedSites.length}
            </Badge>
          </div>

          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {archivedSites.map((site) => {
              const isRestoring = restoreMutation.isPending && restoreMutation.variables === site.id;
              const isDeleting = deleteMutation.isPending && deleteMutation.variables === site.id;

              return (
                <motion.div key={site.id} variants={item}>
                  <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden bg-muted/10">
                    <CardHeader className="p-6 pb-4 flex flex-row items-start justify-between space-y-0">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display font-bold text-lg">{site.name}</h3>
                          <Badge variant="secondary" className="rounded-full">Archived</Badge>
                        </div>
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                        >
                          {getSiteHostname(site.url)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold">
                        {site.name.charAt(0).toUpperCase()}
                      </div>
                    </CardHeader>

                    <CardContent className="p-6 py-4 space-y-4">
                      <SiteDetails site={site} archived />
                    </CardContent>

                    <CardFooter className="p-4 bg-muted/20 flex gap-2 justify-end border-t border-border/50 flex-wrap">
                      <Button asChild variant="ghost" size="sm" className="rounded-lg hover:bg-white hover:text-primary">
                        <a href={buildExportUrl(site.id)}>
                          <Download className="w-4 h-4 mr-2" />
                          Export CSV
                        </a>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-lg hover:bg-white hover:text-primary"
                        onClick={() => restoreMutation.mutate(site.id)}
                        disabled={isRestoring || isDeleting}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        {isRestoring ? "Restoring..." : "Restore"}
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg"
                            disabled={isRestoring || isDeleting}
                            title="Delete archived site permanently"
                          >
                            <Trash2 className="w-4 h-4" />
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
                              className="bg-red-500 hover:bg-red-600 rounded-xl"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </CardFooter>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </section>
      )}
    </Layout>
  );
}

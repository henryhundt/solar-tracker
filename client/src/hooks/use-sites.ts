import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertSite, type PublicSite, type UpdateSiteRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, throwIfResNotOk } from "@/lib/queryClient";
import { SYNC_POLL_INTERVAL_MS } from "@/lib/sync-refresh";

interface UseSitesOptions {
  includeArchived?: boolean;
}

function markSiteAsScraping(site: PublicSite): PublicSite {
  return {
    ...site,
    status: "scraping",
    lastError: null,
  };
}

function updateCachedSiteLists(
  queryClient: QueryClient,
  updateSite: (site: PublicSite) => PublicSite
) {
  queryClient.setQueriesData<PublicSite[]>(
    { queryKey: [api.sites.list.path] },
    (sites) => Array.isArray(sites) ? sites.map(updateSite) : sites
  );
}

function markCachedSiteAsScraping(queryClient: QueryClient, siteId: number) {
  updateCachedSiteLists(queryClient, (site) => (
    site.id === siteId ? markSiteAsScraping(site) : site
  ));

  queryClient.setQueryData<PublicSite | null>(
    [api.sites.get.path, siteId],
    (site) => site ? markSiteAsScraping(site) : site
  );
}

function markCachedActiveSitesAsScraping(queryClient: QueryClient) {
  updateCachedSiteLists(queryClient, (site) => (
    site.archivedAt ? site : markSiteAsScraping(site)
  ));
}

function invalidateSiteQueries(queryClient: QueryClient, siteId?: number) {
  queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
  invalidateReadingQueries(queryClient);

  if (siteId != null) {
    queryClient.invalidateQueries({ queryKey: [api.sites.get.path, siteId] });
  }
}

function invalidateReadingQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [api.readings.summary.path] });
  queryClient.invalidateQueries({ queryKey: [api.readings.list.path] });
}

export function useSites(options: UseSitesOptions = {}) {
  return useQuery({
    queryKey: [api.sites.list.path, options.includeArchived ? "include-archived" : "active-only"],
    queryFn: async (): Promise<PublicSite[]> => {
      const url = new URL(api.sites.list.path, window.location.origin);
      if (options.includeArchived) {
        url.searchParams.set("includeArchived", "true");
      }

      const res = await fetch(url.toString(), {
        credentials: "include",
      });
      await throwIfResNotOk(res);
      return api.sites.list.responses[200].parse(await res.json());
    },
    refetchInterval: (query) => {
      const sites = query.state.data;
      return Array.isArray(sites) && sites.some((site) => site.status === "scraping") ? SYNC_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function useSite(id: number) {
  return useQuery({
    queryKey: [api.sites.get.path, id],
    queryFn: async (): Promise<PublicSite | null> => {
      const url = buildUrl(api.sites.get.path, { id });
      const res = await fetch(url, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      await throwIfResNotOk(res);
      return api.sites.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertSite) => {
      const res = await apiRequest("POST", api.sites.create.path, data);
      return api.sites.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      invalidateSiteQueries(queryClient);
      toast({ title: "Success", description: "Site added successfully" });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateSiteRequest) => {
      const url = buildUrl(api.sites.update.path, { id });
      const res = await apiRequest("PUT", url, updates);
      return api.sites.update.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      invalidateSiteQueries(queryClient, data.id);
      toast({ title: "Updated", description: "Site updated successfully" });
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.sites.delete.path, { id });
      await apiRequest("DELETE", url);
    },
    onSuccess: (_, id) => {
      invalidateSiteQueries(queryClient, id);
      toast({ title: "Deleted", description: "Site and historical data deleted permanently." });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useArchiveSite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.sites.archive.path, { id });
      const res = await apiRequest("POST", url);
      return api.sites.archive.responses[200].parse(await res.json());
    },
    onSuccess: (site) => {
      invalidateSiteQueries(queryClient, site.id);
      toast({ title: "Archived", description: "Site archived and its history was preserved." });
    },
    onError: (error) => {
      toast({
        title: "Archive Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useRestoreSite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.sites.restore.path, { id });
      const res = await apiRequest("POST", url);
      return api.sites.restore.responses[200].parse(await res.json());
    },
    onSuccess: (site) => {
      invalidateSiteQueries(queryClient, site.id);
      toast({ title: "Restored", description: "Site moved back into the active sync list." });
    },
    onError: (error) => {
      toast({
        title: "Restore Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useScrapeSite() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    onMutate: (id) => {
      markCachedSiteAsScraping(queryClient, id);
    },
    mutationFn: async (id: number) => {
      const url = buildUrl(api.sites.scrape.path, { id });
      const res = await apiRequest("POST", url);
      return api.sites.scrape.responses[202].parse(await res.json());
    },
    onSuccess: () => {
      invalidateReadingQueries(queryClient);
      toast({ title: "Sync Started", description: "This site is syncing in the background." });
    },
    onError: (error, id) => {
      invalidateSiteQueries(queryClient, id);
      toast({ 
        title: "Sync Failed", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });
}

export function useSyncAllSites() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    onMutate: () => {
      markCachedActiveSitesAsScraping(queryClient);
    },
    mutationFn: async () => {
      const res = await apiRequest("POST", api.sites.syncAll.path);
      return api.sites.syncAll.responses[202].parse(await res.json());
    },
    onSuccess: () => {
      invalidateReadingQueries(queryClient);
      toast({ title: "Sync Started", description: "All active sites are syncing in the background." });
    },
    onError: (error) => {
      invalidateSiteQueries(queryClient);
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertSite, type PublicSite, type UpdateSiteRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, throwIfResNotOk } from "@/lib/queryClient";

interface UseSitesOptions {
  includeArchived?: boolean;
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
      return Array.isArray(sites) && sites.some((site) => site.status === "scraping") ? 3000 : false;
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
      queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
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
      queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.sites.get.path, data.id] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.readings.list.path] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.readings.list.path] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.readings.list.path] });
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
    mutationFn: async (id: number) => {
      const url = buildUrl(api.sites.scrape.path, { id });
      const res = await apiRequest("POST", url);
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [api.sites.list.path] });
      // Invalidate readings as well since scraping adds new data
      queryClient.invalidateQueries({ queryKey: [api.readings.list.path] });
      toast({ title: "Sync Complete", description: "Latest readings were saved successfully." });
    },
    onError: (error) => {
      toast({ 
        title: "Sync Failed", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });
}

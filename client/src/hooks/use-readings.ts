import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { throwIfResNotOk } from "@/lib/queryClient";
import { SYNC_POLL_INTERVAL_MS } from "@/lib/sync-refresh";

export interface ReadingParams {
  siteId?: number;
  from?: string;
  to?: string;
}

export interface UseReadingsOptions {
  refetchWhileSyncing?: boolean;
}

export function useReadings(params: ReadingParams = {}, options: UseReadingsOptions = {}) {
  // Create a stable key based on params
  const queryKey = [api.readings.list.path, params.siteId, params.from, params.to];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const url = new URL(api.readings.list.path, window.location.origin);
      if (params.siteId) url.searchParams.append("siteId", String(params.siteId));
      if (params.from) url.searchParams.append("from", params.from);
      if (params.to) url.searchParams.append("to", params.to);

      const res = await fetch(url.toString(), {
        credentials: "include",
      });
      await throwIfResNotOk(res);
      
      const data = await res.json();
      return data;
    },
    refetchInterval: options.refetchWhileSyncing ? SYNC_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: true,
  });
}

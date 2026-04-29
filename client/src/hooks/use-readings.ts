import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { throwIfResNotOk } from "@/lib/queryClient";

export interface ReadingParams {
  siteId?: number;
  from?: string;
  to?: string;
}

export function useReadings(params: ReadingParams = {}) {
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
  });
}

import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { DashboardSummaryResponse } from "@shared/schema";
import { throwIfResNotOk } from "@/lib/queryClient";
import { SYNC_POLL_INTERVAL_MS } from "@/lib/sync-refresh";

export interface DashboardSummaryParams {
  from?: string;
}

export interface DashboardSummaryOptions {
  refetchWhileSyncing?: boolean;
}

export function useDashboardSummary(
  params: DashboardSummaryParams = {},
  options: DashboardSummaryOptions = {}
) {
  const queryKey = [api.readings.summary.path, params.from];

  return useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardSummaryResponse> => {
      const url = new URL(api.readings.summary.path, window.location.origin);
      if (params.from) {
        url.searchParams.append("from", params.from);
      }

      const res = await fetch(url.toString(), {
        credentials: "include",
      });
      await throwIfResNotOk(res);

      return res.json();
    },
    refetchInterval: options.refetchWhileSyncing ? SYNC_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: true,
  });
}

import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { DashboardSummaryResponse } from "@shared/schema";
import { throwIfResNotOk } from "@/lib/queryClient";

export interface DashboardSummaryParams {
  from?: string;
}

export function useDashboardSummary(params: DashboardSummaryParams = {}) {
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
  });
}

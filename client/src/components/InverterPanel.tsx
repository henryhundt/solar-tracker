import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicSite } from "@shared/schema";
import type { InverterOverview, InverterReading } from "@shared/inverters";
import { apiRequest } from "@/lib/queryClient";

export function InverterPanel({ site }: { site: PublicSite }) {
  const [open, setOpen] = useState(false);
  const url = `/api/sites/${site.id}/inverters`;
  const query = useQuery<InverterOverview[]>({
    queryKey: [url, site.lastSyncedAt],
    queryFn: async () => (await apiRequest("GET", url)).json(),
    enabled: open,
    staleTime: 60000,
  });
  const [deviceId, setDeviceId] = useState("");
  const history = useQuery<InverterReading[]>({
    queryKey: [url, deviceId, site.lastSyncedAt],
    queryFn: async () => (await apiRequest("GET", `${url}?deviceId=${encodeURIComponent(deviceId)}`)).json(),
    enabled: open && !!deviceId,
    staleTime: 60000,
  });
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: site.timezone, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });

  return (
    <details className="rounded-2xl border p-4" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">Inverter performance</summary>
      {open && (
        <div className="mt-3 overflow-x-auto text-sm">
          {query.isLoading && <p role="status">Loading inverter readings…</p>}
          {query.isError && <button onClick={() => query.refetch()}>Couldn’t load inverter readings. Retry</button>}
          {query.data?.length === 0 && <p className="text-muted-foreground">
            No inverter readings received yet. Device readings appear after a sync when the monitoring portal reports inverter power.
          </p>}
          {!!query.data?.length && <table className="w-full text-left">
            <thead className="text-muted-foreground"><tr><th>Inverter</th><th>Output</th><th>Last reading</th><th>Active faults</th></tr></thead>
            <tbody>{query.data.map(row => <tr key={row.deviceId} className="border-t">
              <td className="py-2 pr-2"><button className="text-primary underline" aria-pressed={deviceId === row.deviceId} onClick={() => setDeviceId(deviceId === row.deviceId ? "" : row.deviceId)}>{row.name}</button><small className="block text-muted-foreground">{row.deviceId}</small></td>
              <td className="pr-2 tabular-nums">{row.powerW === null ? "—" : `${(row.powerW / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kW`}</td>
              <td className="pr-2">{row.timestamp ? formatter.format(new Date(row.timestamp)) : "—"}</td>
              <td className="py-2">
                {row.faults?.length ? <ul className="space-y-2">{row.faults.map((fault, i) =>
                  <li key={i}>
                    <strong className="text-destructive">{fault.code}</strong>
                    {fault.openedAt && <small className="block">Opened {formatter.format(new Date(fault.openedAt))}</small>}
                    {fault.description && <span className="block">{fault.description}</span>}
                    <small className="block">{fault.lastReportedAt ? `Last reported ${formatter.format(new Date(fault.lastReportedAt))}` : "Report time unavailable"}</small>
                  </li>)}</ul> : <span>{row.faultsComplete ? "No active faults" : row.faultCheckedAt ? "No confirmed faults in the partial report" : "Status unavailable"}</span>}
                {row.faults?.length && !row.faultsComplete ? <small className="block">Partial fault report</small> : null}
                {row.faultCheckedAt && <small className="block text-muted-foreground">Checked {formatter.format(new Date(row.faultCheckedAt))}</small>}
              </td>
            </tr>)}</tbody>
          </table>}
          {deviceId && (
            <div className="mt-4">
              <h4 className="font-medium">{query.data?.find(row => row.deviceId === deviceId)?.name} · Last 24 hours of readings</h4>
              {history.isLoading && <p role="status">Loading power history…</p>}
              {history.isError && <button onClick={() => history.refetch()}>Couldn’t load history. Retry</button>}
              {!!history.data?.length && <ResponsiveContainer width="100%" height={180}>
                <LineChart data={history.data.map(row => ({ time: Date.parse(row.timestamp), kW: row.powerW / 1000 }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={value => new Date(value).toLocaleTimeString([], { timeZone: site.timezone, hour: "2-digit", minute: "2-digit" })} />
                  <YAxis unit=" kW" />
                  <Tooltip labelFormatter={value => formatter.format(new Date(Number(value)))} />
                  <Line dataKey="kW" stroke="currentColor" dot isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>}
            </div>
          )}
        </div>
      )}
    </details>
  );
}

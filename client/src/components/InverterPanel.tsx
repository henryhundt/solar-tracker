import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicSite } from "@shared/schema";
import type { InverterOverview, InverterReading } from "@shared/inverters";
import { apiRequest } from "@/lib/queryClient";

export function InverterPanel({ site }: { site: PublicSite }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-2xl border p-4" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">Inverter performance</summary>
      {open && <InverterReadings site={site} />}
    </details>
  );
}

export function InverterReadings({ site }: { site: PublicSite }) {
  const url = `/api/sites/${site.id}/inverters`;
  const query = useQuery<InverterOverview[]>({
    queryKey: [url, site.lastSyncedAt],
    queryFn: async () => (await apiRequest("GET", url)).json(),
    staleTime: 60000,
  });
  const [deviceId, setDeviceId] = useState("");
  const history = useQuery<InverterReading[]>({
    queryKey: [url, deviceId, site.lastSyncedAt],
    queryFn: async () => (await apiRequest("GET", `${url}?deviceId=${encodeURIComponent(deviceId)}`)).json(),
    enabled: !!deviceId,
    staleTime: 60000,
  });
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: site.timezone, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });

  return (
        <div className="mt-3 space-y-3 text-sm">
          {query.isLoading && <p role="status">Loading inverter readings…</p>}
          {query.isError && <button onClick={() => query.refetch()}>Couldn’t load inverter readings. Retry</button>}
          {query.data?.length === 0 && <p className="text-muted-foreground">
            No inverter readings received yet. Device readings appear after a sync when the monitoring portal reports inverter power.
          </p>}
          {query.data?.slice().sort((a, b) => Number(!!b.faults?.length) - Number(!!a.faults?.length)).map(row => (
            <article key={row.deviceId} className="min-w-0 space-y-3 rounded-xl border bg-background/70 p-4 [overflow-wrap:anywhere]">
              <header>
                <h3 className="font-semibold">{row.name}</h3>
                <small className="text-muted-foreground">{row.deviceId}</small>
              </header>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Output</dt><dd>{row.powerW === null ? "Unavailable" : `${(row.powerW / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kW`}</dd></div>
                <div><dt className="text-muted-foreground">Last reading</dt><dd>{row.timestamp ? formatter.format(new Date(row.timestamp)) : "Unavailable"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Active faults</dt><dd>
                {row.faults?.length ? <ul className="space-y-2">{row.faults.map((fault, i) =>
                  <li key={i}>
                    <strong className="text-destructive">{fault.code}</strong>
                    {fault.openedAt && <small className="block">Opened {formatter.format(new Date(fault.openedAt))}</small>}
                    {fault.description && <span className="block">{fault.description}</span>}
                    <small className="block">{fault.lastReportedAt ? `Last reported ${formatter.format(new Date(fault.lastReportedAt))}` : "Report time unavailable"}</small>
                  </li>)}</ul> : <span>{row.faultsComplete ? "No active faults" : row.faultCheckedAt ? "No confirmed faults in the partial report" : "Status unavailable"}</span>}
                {row.faults?.length && !row.faultsComplete ? <small className="block">Partial fault report</small> : null}
                {row.faultCheckedAt && <small className="block text-muted-foreground">Checked {formatter.format(new Date(row.faultCheckedAt))}</small>}
                </dd></div>
              </dl>
              <button className="min-h-11 font-medium text-primary underline" aria-expanded={deviceId === row.deviceId}
                onClick={() => setDeviceId(deviceId === row.deviceId ? "" : row.deviceId)}>
                {deviceId === row.deviceId ? "Hide" : "View"} 24-hour history
              </button>
              {deviceId === row.deviceId && (
            <div className="mt-4">
              <h4 className="font-medium">{row.name} · Last 24 hours of readings</h4>
              {history.isLoading && <p role="status">Loading power history…</p>}
              {history.isError && <button onClick={() => history.refetch()}>Couldn’t load history. Retry</button>}
              {history.data?.length === 0 && <p>No readings in the last 24 hours.</p>}
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
            </article>
          ))}
        </div>
  );
}

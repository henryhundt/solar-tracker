import { LineChart } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ChartDataPoint {
  label: string;
  fullLabel: string;
  energyKwh: number;
}

interface ProductionTrendChartProps {
  chartData: ChartDataPoint[];
  currentWindowDays: number;
  reportingSiteCount: number;
}

export function ProductionTrendChart({
  chartData,
  currentWindowDays,
  reportingSiteCount,
}: ProductionTrendChartProps) {
  return (
    <section className="rounded-[2rem] border border-border/60 bg-card/95 p-5 shadow-sm shadow-slate-950/5 md:p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">Production Trend</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily generation totals for the last {currentWindowDays} days.
          </p>
        </div>
        <div className="rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {reportingSiteCount} reporting site{reportingSiteCount === 1 ? "" : "s"}
        </div>
      </div>

      <div className="h-[320px] w-full">
        {chartData.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[1.5rem] border border-dashed border-border bg-background/60 px-6 text-center">
            <LineChart className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">No production data in this window</p>
              <p className="text-sm text-muted-foreground">
                Run a sync or widen the date range to populate the trend chart.
              </p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={44}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                tickFormatter={(value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`)}
              />
              <Tooltip
                formatter={(value: number) => [`${Number(value).toFixed(1)} kWh`, "Energy"]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                contentStyle={{
                  borderRadius: "16px",
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "rgba(255,255,255,0.96)",
                  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
                }}
              />
              <Area
                type="monotone"
                dataKey="energyKwh"
                stroke="hsl(var(--primary))"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorEnergy)"
                activeDot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

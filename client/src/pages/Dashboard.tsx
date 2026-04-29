import { useState } from "react";
import { useReadings } from "@/hooks/use-readings";
import { useSites } from "@/hooks/use-sites";
import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Zap, Sun, Activity, ArrowUpRight, X, ExternalLink, Download } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, subDays, startOfDay } from "date-fns";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Reading } from "@shared/schema";

interface ChartDataPoint {
  date: string;
  energy: number;
}

export default function Dashboard() {
  const { data: sites, isLoading: isLoadingSites } = useSites();
  const dashboardFrom = startOfDay(subDays(new Date(), 30)).toISOString();
  const { data: readings, isLoading: isLoadingReadings } = useReadings({ from: dashboardFrom });
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const buildExportUrl = () => {
    const url = new URL("/api/readings/export", window.location.origin);
    if (selectedSiteId) {
      url.searchParams.set("siteId", String(selectedSiteId));
    }
    return url.toString();
  };

  // Get selected site name for display
  const selectedSite = sites?.find(s => s.id === selectedSiteId);

  // Filter readings based on selected site
  const filteredReadings = selectedSiteId 
    ? readings?.filter((r: Reading) => r.siteId === selectedSiteId)
    : readings;

  // Calculate Aggregates (use filtered readings for display)
  const totalProduction = filteredReadings?.reduce((sum: number, r: Reading) => sum + r.energyWh, 0) || 0;
  const activeSites = sites?.filter(s => s.status !== 'error').length || 0;
  
  // Format data for chart (use filtered readings)
  const chartData: ChartDataPoint[] = filteredReadings?.reduce((acc: ChartDataPoint[], curr: Reading) => {
    const dateStr = format(new Date(curr.timestamp), 'MMM dd');
    const existing = acc.find(item => item.date === dateStr);
    if (existing) {
      existing.energy += (curr.energyWh / 1000); // Convert to kWh
    } else {
      acc.push({ date: dateStr, energy: (curr.energyWh / 1000) });
    }
    return acc;
  }, []) || [];

  // Sort chart data by date
  chartData.sort((a: ChartDataPoint, b: ChartDataPoint) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  if (isLoadingSites || isLoadingReadings) {
    return (
      <Layout>
        <div className="flex h-[80vh] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-muted-foreground animate-pulse">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (sites?.length === 0) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
            <Activity className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold">No Active Sites</h2>
          <p className="text-muted-foreground max-w-xs">
            Add a solar portal or restore an archived site to monitor production data.
          </p>
          <a href="/sites">
            <Button size="lg" className="rounded-full">
              Manage Sites
            </Button>
          </a>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-8"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold font-display text-foreground tracking-tight">
              {selectedSite ? selectedSite.name : "Overview"}
            </h2>
            <p className="text-muted-foreground mt-1">
              {selectedSite 
                ? "Production data for this site only." 
                : "Summary of your solar production performance."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedSite && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setSelectedSiteId(null)}
                className="rounded-full gap-1"
                data-testid="button-clear-filter"
              >
                <X className="w-4 h-4" />
                Show All Sites
              </Button>
            )}
            <div className="text-sm font-medium px-4 py-2 bg-white dark:bg-card rounded-full border shadow-sm text-muted-foreground">
              Last updated: {format(new Date(), 'MMM dd, HH:mm')}
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-full gap-2">
              <a href={buildExportUrl()}>
                <Download className="w-4 h-4" />
                Export CSV
              </a>
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div variants={itemVariants}>
            <StatCard
              title="Total Production (30 Days)"
              value={`${(totalProduction / 1000).toFixed(1)} kWh`}
              icon={<Zap className="w-5 h-5 text-amber-500" />}
              trend="+12.5%"
              trendUp={true}
              description="Compared to previous week"
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <StatCard
              title="Active Portals"
              value={activeSites}
              icon={<Sun className="w-5 h-5 text-orange-500" />}
              description={`Total ${sites?.length || 0} active sites configured`}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <StatCard
              title="CO₂ Offset"
              value={`${((totalProduction / 1000) * 0.39).toFixed(1)} kg`}
              icon={<Activity className="w-5 h-5 text-green-500" />}
              description="Equivalent to planting 2 trees"
            />
          </motion.div>
        </div>

        {/* Main Chart Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Area Chart */}
          <motion.div variants={itemVariants} className="lg:col-span-2 bg-card rounded-2xl border border-border/50 shadow-sm p-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-lg font-bold text-foreground">Production Trend</h3>
                <p className="text-sm text-muted-foreground">Daily energy generation in kWh</p>
              </div>
            </div>
            
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="energy" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorEnergy)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Recent Activity / Side Panel */}
          <motion.div variants={itemVariants} className="bg-card rounded-2xl border border-border/50 shadow-sm p-6 flex flex-col">
            <h3 className="text-lg font-bold text-foreground mb-6">Site Performance</h3>
            <div className="space-y-6 flex-1 overflow-y-auto pr-2">
              {sites?.map((site) => {
                // Find latest reading for this site
                const siteReadings = readings?.filter((r: Reading) => r.siteId === site.id) || [];
                const latestReading = siteReadings[0];
                const production = latestReading ? (latestReading.energyWh / 1000).toFixed(2) : "0.00";
                const isSelected = selectedSiteId === site.id;

                return (
                  <div 
                    key={site.id} 
                    onClick={() => setSelectedSiteId(isSelected ? null : site.id)}
                    className={cn(
                      "flex items-center justify-between group p-3 rounded-xl transition-colors cursor-pointer",
                      isSelected 
                        ? "bg-primary/10 ring-2 ring-primary/30" 
                        : "hover:bg-muted/50"
                    )}
                    data-testid={`site-card-${site.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm",
                        isSelected 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-orange-100 text-orange-600"
                      )}>
                        {site.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{site.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{site.scraperType} Portal</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-bold text-sm text-foreground">{production} kWh</p>
                        <p className="text-xs text-green-600 flex items-center justify-end gap-1">
                          <ArrowUpRight className="w-3 h-3" />
                          Today
                        </p>
                      </div>
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                        title="Open portal"
                        data-testid={`link-portal-${site.id}`}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                );
              })}
              
              {sites?.length === 0 && (
                <div className="text-center py-10 text-muted-foreground">
                  <p>No sites configured yet.</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </Layout>
  );
}

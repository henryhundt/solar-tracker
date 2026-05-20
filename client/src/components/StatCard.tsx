import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: string;
  trendUp?: boolean;
  className?: string;
  description?: string;
}

export function StatCard({ title, value, icon, trend, trendUp, className, description }: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.25rem] border border-primary/10 bg-card/95 p-5 shadow-sm shadow-slate-950/5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-950/5",
        className
      )}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#34657f] via-[#b7dd79] to-[#fdb71a]" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/20 bg-primary/10 shadow-sm">
            {icon}
          </div>
          <div className="space-y-1.5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </p>
            <h3 className="whitespace-nowrap text-3xl font-black font-sans tabular-nums tracking-tight text-foreground sm:text-[2.35rem]">
              {value}
            </h3>
          </div>
        </div>
        {trend && (
          <div
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
              trendUp
                ? "border-[#b7dd79]/70 bg-[#b7dd79]/20 text-primary"
                : "border-rose-200 bg-rose-50 text-rose-700"
            )}
          >
            {trend}
          </div>
        )}
      </div>
      {description && (
        <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
      )}
      
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-primary/12 via-[#b7dd79]/10 to-transparent blur-2xl" />
    </div>
  );
}

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
        "relative overflow-hidden bg-card rounded-2xl p-6 border border-border/50 shadow-sm transition-all duration-300 hover:shadow-md",
        className
      )}
    >
      <div className="flex justify-between items-start">
        <div className="space-y-4">
          <div className="p-2.5 bg-background rounded-xl border border-border w-fit shadow-sm">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-3xl font-bold font-display tracking-tight text-foreground">{value}</h3>
          </div>
        </div>
        {trend && (
          <div
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-semibold border",
              trendUp
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-700 border-red-200"
            )}
          >
            {trend}
          </div>
        )}
      </div>
      {description && (
        <p className="mt-4 text-sm text-muted-foreground">{description}</p>
      )}
      
      {/* Decorative gradient blob */}
      <div className="absolute -right-6 -top-6 w-24 h-24 bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-2xl pointer-events-none" />
    </div>
  );
}

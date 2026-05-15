import { cn } from "@/lib/utils";
import { getSyncHealth } from "@/lib/site-health";

interface StatusBadgeProps {
  status: "idle" | "scraping" | "error";
  lastError?: string | null;
  lastSyncedAt?: Date | string | null;
}

export function StatusBadge({ status, lastError, lastSyncedAt }: StatusBadgeProps) {
  const syncHealth = getSyncHealth(lastSyncedAt);
  const config = {
    fresh: {
      label: "Synced",
      className: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
      dotClass: "bg-emerald-500",
    },
    scraping: {
      label: "Syncing",
      className: "border-amber-200 bg-amber-50/90 text-amber-700",
      dotClass: "bg-amber-500 animate-pulse",
    },
    error: {
      label: "Needs attention",
      className: "border-rose-200 bg-rose-50/90 text-rose-700",
      dotClass: "bg-red-500",
    },
    stale: {
      label: "Stale data",
      className: "border-amber-200 bg-amber-50/90 text-amber-700",
      dotClass: "bg-amber-500",
    },
    never: {
      label: "Not synced",
      className: "border-slate-200 bg-slate-50/90 text-slate-600",
      dotClass: "bg-slate-400",
    },
  };

  const current = status === "error"
    ? config.error
    : status === "scraping"
    ? config.scraping
    : syncHealth === "stale"
    ? config.stale
    : syncHealth === "never"
    ? config.never
    : config.fresh;

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
          current.className
        )}
      >
        <div className={cn("w-1.5 h-1.5 rounded-full", current.dotClass)} />
        {current.label}
      </div>
      {status === "error" && lastError && (
        <span className="max-w-[220px] text-xs leading-4 text-rose-600 truncate" title={lastError}>
          {lastError}
        </span>
      )}
    </div>
  );
}

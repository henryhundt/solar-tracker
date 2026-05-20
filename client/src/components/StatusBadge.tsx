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
      className: "border-[#b7dd79]/70 bg-[#b7dd79]/20 text-primary",
      dotClass: "bg-[#b7dd79]",
    },
    scraping: {
      label: "Syncing",
      className: "border-[#fdb71a]/50 bg-[#fdb71a]/15 text-primary",
      dotClass: "bg-[#fdb71a] animate-pulse",
    },
    error: {
      label: "Needs attention",
      className: "border-rose-200 bg-rose-50/90 text-rose-700",
      dotClass: "bg-red-500",
    },
    stale: {
      label: "Stale data",
      className: "border-[#fdb71a]/50 bg-[#fdb71a]/15 text-primary",
      dotClass: "bg-[#fdb71a]",
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

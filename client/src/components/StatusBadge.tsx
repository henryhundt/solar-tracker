import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "idle" | "scraping" | "error";
  lastError?: string | null;
}

export function StatusBadge({ status, lastError }: StatusBadgeProps) {
  const config = {
    idle: {
      label: "Synced",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dotClass: "bg-emerald-500",
    },
    scraping: {
      label: "Scraping...",
      className: "bg-amber-50 text-amber-700 border-amber-200",
      dotClass: "bg-amber-500 animate-pulse",
    },
    error: {
      label: "Error",
      className: "bg-red-50 text-red-700 border-red-200",
      dotClass: "bg-red-500",
    },
  };

  const current = config[status] || config.idle;

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={cn(
          "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
          current.className
        )}
      >
        <div className={cn("w-1.5 h-1.5 rounded-full", current.dotClass)} />
        {current.label}
      </div>
      {status === "error" && lastError && (
        <span className="text-xs text-red-500 max-w-[150px] truncate" title={lastError}>
          {lastError}
        </span>
      )}
    </div>
  );
}

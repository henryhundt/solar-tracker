import { cn } from "@/lib/utils";

interface HoffmanMarkProps {
  className?: string;
}

export function HoffmanMark({ className }: HoffmanMarkProps) {
  return (
    <div
      className={cn(
        "grid h-10 w-10 grid-cols-[1fr_0.7fr_1fr] grid-rows-2 gap-1",
        className
      )}
      aria-hidden="true"
    >
      <span className="row-span-2 rounded-[2px] bg-[#34657f]" />
      <span className="rounded-[2px] bg-[#b7dd79]" />
      <span className="row-span-2 rounded-[2px] bg-[#34657f]" />
      <span className="rounded-[2px] bg-[#b7dd79]" />
    </div>
  );
}

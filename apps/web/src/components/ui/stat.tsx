import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

const DELTA_TONE = {
  up: "text-status-done-fg",
  down: "text-status-dead-fg",
  warn: "text-status-conflict-fg",
  neutral: "text-muted-foreground",
} as const;

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  deltaTone?: "up" | "down" | "warn" | "neutral";
  icon?: ReactNode;
  className?: string;
}

export function Stat({
  label,
  value,
  unit,
  delta,
  deltaTone = "neutral",
  icon,
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-card px-5 py-4 shadow-[var(--inset-top)]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon && <span className="inline-flex">{icon}</span>}
        <span className="text-xs leading-none font-medium tracking-[0.01em]">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xl leading-none font-semibold tracking-[-0.01em] text-foreground tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="font-sans text-sm leading-none font-normal text-faint-foreground">
            {unit}
          </span>
        )}
        {delta != null && (
          <span
            className={cn(
              "ml-auto font-mono text-xs leading-none font-medium",
              DELTA_TONE[deltaTone],
            )}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

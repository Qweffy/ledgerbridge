import { type CSSProperties } from "react";
import { SYNC_STATUS_LABEL, type SyncStatus } from "@ledgerbridge/shared";
import { cn } from "@/lib/utils";

const PULSE: Partial<Record<SyncStatus, true>> = { inflight: true };

export interface StatusBadgeProps {
  /** One of the fixed sync states — drives color + canonical label. */
  status: SyncStatus;
  /** Override the canonical label text (rarely needed). */
  label?: string;
  size?: "sm" | "md";
  variant?: "soft" | "outline" | "solid";
  /** Show the leading status dot. @default true */
  dot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  size = "md",
  variant = "soft",
  dot = true,
  className,
}: StatusBadgeProps) {
  const text = label ?? SYNC_STATUS_LABEL[status];
  const sm = size === "sm";

  const vars = {
    "--sb-fg": `var(--sb-${status}-fg)`,
    "--sb-fill": `var(--sb-${status}-fill)`,
    "--sb-solid": `var(--sb-${status}-solid)`,
  } as CSSProperties;

  const skin =
    variant === "soft"
      ? "border-transparent bg-[var(--sb-fill)] text-[var(--sb-fg)]"
      : variant === "outline"
        ? "border-[color-mix(in_oklch,var(--sb-solid)_40%,transparent)] bg-transparent text-[var(--sb-fg)]"
        : "border-transparent bg-[var(--sb-solid)] text-[var(--color-neutral-1000)]";

  return (
    <span
      style={vars}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-pill border font-medium leading-none tracking-[0.005em]",
        sm
          ? "h-[18px] gap-[5px] px-[7px] py-px text-2xs"
          : "h-[22px] gap-1.5 px-[9px] py-0.5 text-xs",
        skin,
        className,
      )}
    >
      {dot && (
        <span className="relative inline-flex">
          <span
            className={cn(
              "rounded-full",
              sm ? "size-[5px]" : "size-1.5",
              variant === "solid"
                ? "bg-[var(--color-neutral-1000)]"
                : "bg-[var(--sb-solid)]",
            )}
          />
          {PULSE[status] && variant !== "solid" && (
            <span className="absolute inset-0 animate-[lb-pulse_1.6s_var(--ease-in-out)_infinite] rounded-full bg-[var(--sb-solid)] motion-reduce:animate-none" />
          )}
        </span>
      )}
      {text}
    </span>
  );
}

import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: {
    fg: "var(--foreground-secondary)",
    fill: "var(--surface-hover)",
    solid: "var(--color-neutral-600)",
  },
  accent: {
    fg: "var(--color-primary-300)",
    fill: "oklch(0.625 0.175 255 / 0.14)",
    solid: "var(--primary)",
  },
  green: {
    fg: "var(--color-emerald-400)",
    fill: "oklch(0.680 0.155 155 / 0.14)",
    solid: "var(--color-emerald-500)",
  },
  amber: {
    fg: "var(--color-amber-400)",
    fill: "oklch(0.780 0.150 75 / 0.15)",
    solid: "var(--color-amber-500)",
  },
  red: {
    fg: "var(--color-rose-400)",
    fill: "oklch(0.630 0.215 25 / 0.15)",
    solid: "var(--color-rose-500)",
  },
  violet: {
    fg: "var(--color-violet-400)",
    fill: "oklch(0.660 0.180 295 / 0.15)",
    solid: "var(--color-violet-500)",
  },
} as const;

export interface BadgeProps {
  tone?: keyof typeof TONES;
  variant?: "soft" | "outline" | "solid";
  size?: "sm" | "md";
  children?: ReactNode;
  className?: string;
}

export function Badge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  children,
  className,
}: BadgeProps) {
  const t = TONES[tone];
  const sm = size === "sm";
  const vars = {
    "--bd-fg": t.fg,
    "--bd-fill": t.fill,
    "--bd-solid": t.solid,
  } as CSSProperties;

  const skin =
    variant === "soft"
      ? "border-transparent bg-[var(--bd-fill)] text-[var(--bd-fg)]"
      : variant === "outline"
        ? "border-input bg-transparent text-[var(--bd-fg)]"
        : "border-transparent bg-[var(--bd-solid)] text-[var(--color-neutral-1000)]";

  return (
    <span
      style={vars}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border font-medium leading-none whitespace-nowrap tabular-nums",
        sm ? "h-[18px] px-1.5 py-px text-2xs" : "h-5 px-2 py-0.5 text-xs",
        skin,
        className,
      )}
    >
      {children}
    </span>
  );
}

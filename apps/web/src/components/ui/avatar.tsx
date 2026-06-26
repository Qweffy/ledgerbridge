import { cn } from "@/lib/utils";

const TINTS = [
  "oklch(0.625 0.175 255 / 0.14)",
  "oklch(0.680 0.155 155 / 0.14)",
  "oklch(0.780 0.150 75 / 0.15)",
  "oklch(0.660 0.180 295 / 0.15)",
  "oklch(0.715 0.130 215 / 0.14)",
];
const FGS = [
  "var(--color-primary-300)",
  "var(--color-emerald-400)",
  "var(--color-amber-400)",
  "var(--color-violet-400)",
  "var(--color-sky-400)",
];

export interface AvatarProps {
  name?: string;
  src?: string;
  /** Diameter in pixels. @default 24 */
  size?: number;
  /** Use the neutral system tone instead of a name-derived color. */
  tone?: "system";
  className?: string;
}

export function Avatar({
  name = "",
  src,
  size = 24,
  tone,
  className,
}: AvatarProps) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";
  const idx =
    [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length;
  const isSystem = tone === "system";
  const bg = isSystem ? "var(--popover)" : (TINTS[idx] ?? "transparent");
  const fg = isSystem ? "var(--muted-foreground)" : (FGS[idx] ?? "var(--foreground)");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border leading-none font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: src ? "transparent" : bg,
        color: fg,
        fontSize: Math.max(9, size * 0.4),
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

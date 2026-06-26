import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const HEIGHTS = { sm: "h-7", md: "h-8", lg: "h-[38px]" } as const;

export interface InputProps extends Omit<ComponentProps<"input">, "size"> {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  /** Render value in Geist Mono with tabular figures — use for IDs/amounts. */
  mono?: boolean;
}

export function Input({
  size = "md",
  invalid = false,
  leadingIcon,
  trailingSlot,
  mono = false,
  disabled,
  className,
  ...rest
}: InputProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 transition-[border-color,box-shadow] duration-[140ms]",
        HEIGHTS[size],
        disabled ? "bg-surface-sunken opacity-60" : "bg-card",
        invalid
          ? "border-destructive focus-within:shadow-[0_0_0_3px_var(--status-dead-bg)]"
          : "border-input focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--ring)]",
        className,
      )}
    >
      {leadingIcon && (
        <span className="inline-flex shrink-0 text-faint-foreground">
          {leadingIcon}
        </span>
      )}
      <input
        disabled={disabled}
        className={cn(
          "min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-faint-foreground",
          mono ? "font-mono tabular-nums" : "font-sans",
        )}
        {...rest}
      />
      {trailingSlot && (
        <span className="inline-flex shrink-0 text-faint-foreground">
          {trailingSlot}
        </span>
      )}
    </div>
  );
}

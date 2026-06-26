import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

const HEIGHTS = { sm: "h-7", md: "h-8", lg: "h-[38px]" } as const;

export interface SelectProps extends Omit<ComponentProps<"select">, "size"> {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
}

export function Select({
  size = "md",
  invalid = false,
  disabled,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <div className="relative inline-flex">
      <select
        disabled={disabled}
        className={cn(
          "w-full appearance-none rounded-md border pr-[30px] pl-2.5 text-sm font-normal leading-none text-foreground transition-[border-color,box-shadow] duration-[140ms] focus:outline-none",
          HEIGHTS[size],
          disabled
            ? "cursor-not-allowed bg-surface-sunken opacity-60"
            : "cursor-pointer bg-card",
          invalid
            ? "border-destructive focus:shadow-[0_0_0_3px_var(--status-dead-bg)]"
            : "border-input focus:border-primary focus:shadow-[0_0_0_3px_var(--ring)]",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-[9px] -translate-y-1/2 text-faint-foreground"
      >
        <path
          d="m7 10 5 5 5-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

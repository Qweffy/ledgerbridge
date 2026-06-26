"use client";

import { type ComponentProps, type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

const DIMS = {
  sm: { track: "h-[18px] w-[30px]", knob: "size-[14px]", slide: 12 },
  md: { track: "h-[21px] w-[36px]", knob: "size-[17px]", slide: 15 },
} as const;

export interface SwitchProps
  extends Omit<ComponentProps<"input">, "type" | "size"> {
  size?: "sm" | "md";
  label?: ReactNode;
}

export function Switch({
  checked,
  defaultChecked,
  disabled,
  label,
  size = "md",
  onChange,
  className,
  ...rest
}: SwitchProps) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const on = isControlled ? Boolean(checked) : internal;
  const d = DIMS[size];

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2.5 select-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className={cn("relative inline-flex", d.track)}>
        <input
          type="checkbox"
          checked={isControlled ? checked : undefined}
          defaultChecked={isControlled ? undefined : defaultChecked}
          disabled={disabled}
          onChange={(e) => {
            if (!isControlled) setInternal(e.target.checked);
            onChange?.(e);
          }}
          className="absolute m-0 size-full opacity-0"
          {...rest}
        />
        <span
          className={cn(
            "relative inline-flex w-full items-center rounded-pill border transition-[background-color,border-color] duration-[220ms] ease-standard",
            on
              ? "border-primary bg-primary"
              : "border-border-strong bg-[var(--color-neutral-700)]",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 left-0.5 rounded-full bg-[var(--color-neutral-0)] shadow-xs transition-transform duration-[220ms] ease-out",
              d.knob,
            )}
            style={{
              transform: on
                ? `translateY(-50%) translateX(${d.slide}px)`
                : "translateY(-50%)",
            }}
          />
        </span>
      </span>
      {label && (
        <span className="text-sm leading-snug font-medium text-foreground">
          {label}
        </span>
      )}
    </label>
  );
}

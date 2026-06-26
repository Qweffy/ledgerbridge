"use client";

import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<ComponentProps<"input">, "type" | "size"> {
  indeterminate?: boolean;
  label?: ReactNode;
}

export function Checkbox({
  checked,
  defaultChecked,
  indeterminate = false,
  disabled,
  label,
  onChange,
  className,
  ...rest
}: CheckboxProps) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const on = isControlled ? Boolean(checked) : internal;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const filled = on || indeterminate;

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 select-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative inline-flex">
        <input
          ref={ref}
          type="checkbox"
          checked={isControlled ? checked : undefined}
          defaultChecked={isControlled ? undefined : defaultChecked}
          disabled={disabled}
          onChange={(e) => {
            if (!isControlled) setInternal(e.target.checked);
            onChange?.(e);
          }}
          className="absolute m-0 size-4 opacity-0"
          {...rest}
        />
        <span
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-xs border text-primary-foreground transition-[background-color,border-color] duration-[140ms]",
            filled ? "border-primary bg-primary" : "border-border-strong bg-card",
          )}
        >
          {indeterminate ? (
            <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M6 12h12"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          ) : on ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m5 12 4.5 4.5L19 7"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
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

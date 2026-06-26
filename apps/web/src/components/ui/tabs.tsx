"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Optional count chip (e.g. queue size). */
  count?: number;
  /** Optional leading lucide icon. */
  icon?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  className,
}: TabsProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | undefined>(
    defaultValue ?? items[0]?.value,
  );
  const active = isControlled ? value : internal;

  const select = (v: string) => {
    if (!isControlled) setInternal(v);
    onChange?.(v);
  };

  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-1 border-b", className)}
    >
      {items.map((it) => {
        const on = it.value === active;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => select(it.value)}
            className={cn(
              "relative inline-flex h-[34px] cursor-pointer items-center gap-1.5 px-2.5 text-sm leading-none font-medium transition-colors duration-[140ms]",
              on
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground-secondary",
            )}
          >
            {it.icon && <span className="inline-flex">{it.icon}</span>}
            {it.label}
            {it.count != null && (
              <span
                className={cn(
                  "rounded-pill bg-surface-hover px-[5px] py-0.5 font-mono text-2xs leading-none font-medium tabular-nums",
                  on ? "text-foreground-secondary" : "text-faint-foreground",
                )}
              >
                {it.count}
              </span>
            )}
            <span
              className={cn(
                "absolute right-1.5 -bottom-px left-1.5 h-0.5 rounded-t-[2px] transition-colors duration-[140ms]",
                on ? "bg-primary" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

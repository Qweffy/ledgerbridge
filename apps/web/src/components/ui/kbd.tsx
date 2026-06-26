import { type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type KbdProps = ComponentProps<"kbd">;

export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-b-2 border-input bg-popover px-[5px] font-mono text-2xs leading-none font-medium text-foreground-secondary",
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}

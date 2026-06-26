import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends Omit<ComponentProps<"section">, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Apply body padding. Set false for flush tables/lists. @default true */
  padded?: boolean;
}

export function Card({
  title,
  description,
  actions,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border bg-card shadow-[var(--inset-top)]",
        className,
      )}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="text-md leading-[1.3] font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-[3px] text-xs leading-[1.4] text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

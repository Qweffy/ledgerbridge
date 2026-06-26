import { type ComponentProps, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center rounded-sm border transition-[background-color,color] duration-[140ms] ease-standard hover:bg-surface-hover hover:text-foreground active:bg-surface-active disabled:cursor-not-allowed disabled:opacity-[0.45]",
  {
    variants: {
      variant: {
        ghost: "border-transparent bg-transparent text-muted-foreground",
        outline: "border-input bg-card text-foreground-secondary",
        solid: "border-input bg-popover text-foreground",
      },
      size: { sm: "size-6", md: "size-7", lg: "size-8" },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends Omit<ComponentProps<"button">, "children">,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible label — required, used for aria-label + tooltip title. */
  label: string;
  /** A single lucide icon node. */
  children: ReactNode;
}

export function IconButton({
  variant,
  size,
  label,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...rest}
    >
      {children}
    </button>
  );
}

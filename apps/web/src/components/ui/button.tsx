import { type ComponentProps, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium leading-none tracking-[-0.005em] transition-[background-color,border-color,opacity] duration-[140ms] ease-standard select-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border-input bg-popover text-foreground shadow-[var(--inset-top)] hover:bg-surface-active active:bg-surface-active",
        ghost:
          "border-transparent bg-transparent text-foreground-secondary hover:bg-surface-hover active:bg-surface-active",
        subtle:
          "border-transparent bg-surface-hover text-foreground hover:bg-surface-active active:bg-surface-active",
        danger:
          "border-transparent bg-[var(--color-rose-500)] text-primary-foreground shadow-xs hover:bg-[var(--color-rose-400)] active:bg-[var(--color-rose-600)]",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-[38px] px-4 text-sm",
      },
      fullWidth: { true: "w-full", false: "w-auto" },
    },
    defaultVariants: { variant: "secondary", size: "md", fullWidth: false },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="inline-block size-[13px] animate-[lb-spin_0.6s_linear_infinite] rounded-full border-[1.6px] border-current border-t-transparent"
        />
      ) : (
        leadingIcon && <span className="inline-flex">{leadingIcon}</span>
      )}
      {children}
      {!loading && trailingIcon && (
        <span className="inline-flex">{trailingIcon}</span>
      )}
    </button>
  );
}

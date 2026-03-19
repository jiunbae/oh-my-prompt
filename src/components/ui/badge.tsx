import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "outline"
  | "info"
  | "gradient";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-primary/15 text-primary border-primary/25",
  secondary: "bg-secondary text-secondary-foreground border-border",
  success: "bg-chart-2/15 text-chart-2 border-chart-2/25",
  warning: "bg-chart-4/15 text-chart-4 border-chart-4/25",
  error: "bg-destructive/15 text-destructive border-destructive/25",
  outline: "bg-transparent text-muted-foreground border-border",
  info: "bg-chart-1/15 text-chart-1 border-chart-1/25",
  gradient:
    "border-0 bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] text-white",
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

export { Badge, type BadgeProps, type BadgeVariant };

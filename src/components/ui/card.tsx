import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "elevated" | "outlined" | "glass" | "interactive";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantStyles: Record<CardVariant, string> = {
  default: "border border-border bg-card text-card-foreground shadow-sm",
  // `elevated` must read as raised on every theme. In light mode, --card
  // (#ffffff) and --surface-elevated (#fafafb) are intentionally a hair apart;
  // we lean on shadow + a slightly stronger border to do the rest of the work.
  elevated:
    "border border-border bg-surface-elevated text-card-foreground shadow-lg shadow-black/[0.08] ring-1 ring-border-subtle",
  outlined: "border-2 border-border bg-transparent text-card-foreground",
  glass: "border border-border/50 bg-card/80 backdrop-blur-sm text-card-foreground shadow-sm",
  interactive:
    "border border-border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:border-border-strong/30 hover:shadow-[0_0_20px_var(--glow)] hover:-translate-y-px cursor-pointer",
};

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("rounded-lg", variantStyles[variant], className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

/* CardGradientBar — decorative top gradient strip */
interface CardGradientBarProps extends HTMLAttributes<HTMLDivElement> {
  height?: string;
}

const CardGradientBar = forwardRef<HTMLDivElement, CardGradientBarProps>(
  ({ className, height = "h-1", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "w-full rounded-t-lg bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)]",
          height,
          className
        )}
        {...props}
      />
    );
  }
);

CardGradientBar.displayName = "CardGradientBar";

type CardHeaderProps = HTMLAttributes<HTMLDivElement>;

const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col space-y-1.5 p-6", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardHeader.displayName = "CardHeader";

type CardTitleProps = HTMLAttributes<HTMLHeadingElement>;

const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <h3
        ref={ref}
        className={cn("text-lg font-semibold text-foreground", className)}
        {...props}
      >
        {children}
      </h3>
    );
  }
);

CardTitle.displayName = "CardTitle";

type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
      >
        {children}
      </p>
    );
  }
);

CardDescription.displayName = "CardDescription";

type CardContentProps = HTMLAttributes<HTMLDivElement>;

const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("p-6 pt-0", className)} {...props}>
        {children}
      </div>
    );
  }
);

CardContent.displayName = "CardContent";

type CardFooterProps = HTMLAttributes<HTMLDivElement>;

const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex items-center p-6 pt-0", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

CardFooter.displayName = "CardFooter";

export {
  Card,
  CardGradientBar,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
  type CardVariant,
};

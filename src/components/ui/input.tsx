import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          // input uses --input-border (3:1+ vs --background in every theme),
          // not the lower-emphasis --border-subtle.
          "flex h-10 w-full rounded-md border border-input-border bg-input-bg px-3 py-2 text-sm text-foreground",
          "placeholder:text-muted-foreground transition-colors duration-150",
          "focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input, type InputProps };

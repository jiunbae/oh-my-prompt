"use client";

import { cn } from "@/lib/utils";

interface CheckboxRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  "aria-label"?: string;
}

export function CheckboxRow({
  checked,
  onChange,
  className,
  "aria-label": ariaLabel,
}: CheckboxRowProps) {
  return (
    <label
      className={cn(
        "inline-flex items-center justify-center cursor-pointer",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className={cn(
          "h-4 w-4 rounded border-border text-primary cursor-pointer",
          "bg-input-bg transition-colors",
          "focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
          "accent-primary"
        )}
      />
    </label>
  );
}
"use client";

/**
 * SegmentedControl — radio-group wrapper around a row of buttons.
 *
 *   <SegmentedControl
 *     value={range}
 *     onValueChange={setRange}
 *     aria-label="Date range"
 *     options={[
 *       { value: "7d", label: "7d" },
 *       { value: "30d", label: "30d" },
 *       { value: "90d", label: "90d" },
 *     ]}
 *   />
 *
 * - `role="radiogroup"` on the wrapper; each option is `role="radio"` with
 *   `aria-checked`.
 * - Roving tabindex: only the selected option is in the tab order. Arrow keys
 *   move the selection (and focus) like a radio group should.
 */

import {
  forwardRef,
  useCallback,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<V extends string = string>
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: V;
  onValueChange: (next: V) => void;
  options: ReadonlyArray<SegmentedOption<V>>;
  /** Required for screen readers. */
  "aria-label"?: string;
  /** Optional ID of a visible label. */
  "aria-labelledby"?: string;
  size?: "sm" | "md";
}

const sizeStyles = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-sm",
};

function SegmentedControlInner<V extends string = string>(
  {
    value,
    onValueChange,
    options,
    size = "md",
    className,
    ...props
  }: SegmentedControlProps<V>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const optionRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const focusValue = useCallback((v: string) => {
    optionRefs.current.get(v)?.focus();
  }, []);

  const handleKeyDown =
    (current: V) =>
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const enabled = options.filter((o) => !o.disabled);
      if (enabled.length === 0) return;
      const idx = enabled.findIndex((o) => o.value === current);
      if (idx === -1) return;

      let next: SegmentedOption<V> | null = null;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = enabled[(idx + 1) % enabled.length];
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = enabled[(idx - 1 + enabled.length) % enabled.length];
          break;
        case "Home":
          next = enabled[0];
          break;
        case "End":
          next = enabled[enabled.length - 1];
          break;
        default:
          return;
      }
      if (next) {
        e.preventDefault();
        onValueChange(next.value);
        requestAnimationFrame(() => focusValue(next!.value));
      }
    };

  return (
    <div
      ref={ref}
      role="radiogroup"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5",
        className
      )}
      {...props}
    >
      {options.map((opt) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              optionRefs.current.set(opt.value, el);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={opt.disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              if (!opt.disabled) onValueChange(opt.value);
            }}
            onKeyDown={handleKeyDown(opt.value)}
            className={cn(
              "inline-flex items-center justify-center rounded-sm font-medium transition-colors duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "disabled:pointer-events-none disabled:opacity-50",
              sizeStyles[size],
              checked
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const SegmentedControl = forwardRef(SegmentedControlInner) as <
  V extends string = string,
>(
  props: SegmentedControlProps<V> & { ref?: React.ForwardedRef<HTMLDivElement> }
) => ReturnType<typeof SegmentedControlInner>;

export { SegmentedControl };
export type { SegmentedControlProps, SegmentedOption };

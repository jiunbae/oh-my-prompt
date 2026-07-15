"use client";

/**
 * Tooltip — hover/focus-triggered, delayed reveal, `role="tooltip"`.
 *
 *   <Tooltip content="Save the file">
 *     <Button>Save</Button>
 *   </Tooltip>
 *
 * - The wrapper handles bubbling pointer/focus events; the single trigger
 *   child is cloned only to wire up `aria-describedby`.
 * - The tooltip itself uses `useId` so a screen-reader can resolve the
 *   description.
 * - The trigger child should already be focusable (e.g. a Button) for the
 *   tooltip to be discoverable via keyboard.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  /** Delay before showing (ms). Default 300. */
  delay?: number;
  /** Where to place the tooltip relative to the trigger. */
  side?: "top" | "bottom" | "left" | "right";
  /** Distance between trigger and tooltip in px. */
  sideOffset?: number;
  /** Disable the tooltip entirely (still renders the child). */
  disabled?: boolean;
  className?: string;
}

const positionClasses: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-[var(--tt-offset)]",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-[var(--tt-offset)]",
  left: "right-full top-1/2 -translate-y-1/2 mr-[var(--tt-offset)]",
  right: "left-full top-1/2 -translate-y-1/2 ml-[var(--tt-offset)]",
};

function Tooltip({
  content,
  children,
  delay = 300,
  side = "top",
  sideOffset = 6,
  disabled = false,
  className,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback(
    (next: boolean) => {
      clearTimer();
      if (disabled) return;
      if (!next) {
        // closing is immediate to avoid stuck tooltips on rapid moves
        setOpen(false);
        return;
      }
      timer.current = setTimeout(() => setOpen(true), delay);
    },
    [clearTimer, delay, disabled]
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  // Close on Escape so keyboard users can dismiss.
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!isValidElement(children)) {
    throw new Error("Tooltip requires a single React element child.");
  }

  const onlyChild = Children.only(children) as ReactElement<{
    "aria-describedby"?: string;
  }>;

  const childProps = onlyChild.props as {
    "aria-describedby"?: string;
  };

  const trigger = cloneElement(onlyChild, {
    "aria-describedby": open
      ? [childProps["aria-describedby"], id].filter(Boolean).join(" ")
      : childProps["aria-describedby"],
  } as Partial<typeof onlyChild.props>);

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => schedule(true)}
      onPointerLeave={() => schedule(false)}
      onFocus={() => schedule(true)}
      onBlur={() => schedule(false)}
    >
      {trigger}
      {open && !disabled ? (
        <span
          role="tooltip"
          id={id}
          style={{ ["--tt-offset" as string]: `${sideOffset}px` }}
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground shadow-md",
            positionClasses[side],
            className
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export { Tooltip };
export type { TooltipProps };

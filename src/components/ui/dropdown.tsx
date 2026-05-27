"use client";

/**
 * Dropdown menu — hand-rolled, no portals.
 *
 *   <Dropdown>
 *     <DropdownTrigger asChild>
 *       <Button>Open</Button>
 *     </DropdownTrigger>
 *     <DropdownContent align="end">
 *       <DropdownItem onSelect={() => …}>Edit</DropdownItem>
 *       <DropdownSeparator />
 *       <DropdownItem onSelect={() => …}>Delete</DropdownItem>
 *     </DropdownContent>
 *   </Dropdown>
 *
 * Behaviour
 * - Trigger announces `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`
 * - Content is `role="menu"`; items are `role="menuitem"`
 * - Escape closes and returns focus to the trigger
 * - Outside-click closes
 * - Up/Down arrows roving focus inside the menu; Home/End jump
 */

import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";

interface DropdownContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  menuId: string;
  triggerId: string;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext(component: string) {
  const ctx = useContext(DropdownContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Dropdown>.`);
  }
  return ctx;
}

interface DropdownProps {
  children: ReactNode;
  /** Uncontrolled initial state */
  defaultOpen?: boolean;
  /** Controlled */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

function Dropdown({ children, defaultOpen = false, open: openProp, onOpenChange }: DropdownProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setOpenState(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  // Click outside closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (contentRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Listen on pointerdown so we fire before any click handlers inside.
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [open, setOpen]);

  // Escape closes + returns focus to the trigger
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const ctx = useMemo<DropdownContextValue>(
    () => ({
      open,
      setOpen,
      triggerRef,
      contentRef,
      menuId: `${baseId}-menu`,
      triggerId: `${baseId}-trigger`,
    }),
    [open, setOpen, baseId]
  );

  return <DropdownContext.Provider value={ctx}>{children}</DropdownContext.Provider>;
}

interface DropdownTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Forward the trigger props to the child instead of rendering a <button>.
   * The child must accept `ref`, `aria-*`, `onClick`, and `onKeyDown`.
   */
  asChild?: boolean;
}

const DropdownTrigger = forwardRef<HTMLButtonElement, DropdownTriggerProps>(
  ({ asChild = false, children, onClick, onKeyDown, ...props }, forwardedRef) => {
    const ctx = useDropdownContext("DropdownTrigger");

    const handleRef = useCallback(
      (el: HTMLElement | null) => {
        ctx.triggerRef.current = el;
        if (typeof forwardedRef === "function")
          forwardedRef(el as HTMLButtonElement | null);
        else if (forwardedRef)
          (forwardedRef as React.MutableRefObject<HTMLButtonElement | null>).current =
            el as HTMLButtonElement | null;
      },
      [ctx, forwardedRef]
    );

    const sharedProps = {
      id: ctx.triggerId,
      "aria-haspopup": "menu" as const,
      "aria-expanded": ctx.open,
      "aria-controls": ctx.open ? ctx.menuId : undefined,
      onClick: (e: MouseEvent<HTMLElement>) => {
        onClick?.(e as MouseEvent<HTMLButtonElement>);
        if (!e.defaultPrevented) ctx.setOpen(!ctx.open);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(e as KeyboardEvent<HTMLButtonElement>);
        if (e.defaultPrevented) return;
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ctx.setOpen(true);
          // Move focus to first item once content mounts
          requestAnimationFrame(() => {
            const first = ctx.contentRef.current?.querySelector<HTMLElement>(
              '[role="menuitem"]:not([data-disabled="true"])'
            );
            first?.focus();
          });
        }
      },
    };

    if (asChild) {
      // Clone the single child and merge our props
      const onlyChild = Children.only(children) as ReactElement<{
        ref?: Ref<HTMLElement>;
        onClick?: (e: MouseEvent<HTMLElement>) => void;
        onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
      }>;
      if (!isValidElement(onlyChild)) {
        throw new Error("DropdownTrigger asChild requires a single React element child.");
      }
      return cloneElement(onlyChild, {
        ...sharedProps,
        ref: handleRef,
      } as Partial<typeof onlyChild.props>);
    }

    return (
      <button ref={handleRef} type="button" {...props} {...sharedProps}>
        {children}
      </button>
    );
  }
);
DropdownTrigger.displayName = "DropdownTrigger";

interface DropdownContentProps extends HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment relative to the trigger. */
  align?: "start" | "end";
  /** Vertical offset in px from the trigger. */
  sideOffset?: number;
}

const DropdownContent = forwardRef<HTMLDivElement, DropdownContentProps>(
  ({ className, align = "start", sideOffset = 4, children, onKeyDown, ...props }, forwardedRef) => {
    const ctx = useDropdownContext("DropdownContent");

    const handleRef = useCallback(
      (el: HTMLDivElement | null) => {
        ctx.contentRef.current = el;
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef)
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      },
      [ctx, forwardedRef]
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      const items = Array.from(
        ctx.contentRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([data-disabled="true"])'
        ) ?? []
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? items.indexOf(active) : -1;

      let nextIdx: number | null = null;
      switch (e.key) {
        case "ArrowDown":
          nextIdx = idx < 0 ? 0 : (idx + 1) % items.length;
          break;
        case "ArrowUp":
          nextIdx = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
          break;
        case "Home":
          nextIdx = 0;
          break;
        case "End":
          nextIdx = items.length - 1;
          break;
        case "Tab":
          // Closing on Tab keeps focus order natural.
          ctx.setOpen(false);
          return;
        default:
          return;
      }
      if (nextIdx !== null) {
        e.preventDefault();
        items[nextIdx]?.focus();
      }
    };

    if (!ctx.open) return null;

    return (
      <div
        ref={handleRef}
        role="menu"
        id={ctx.menuId}
        aria-labelledby={ctx.triggerId}
        // Positioning: caller wraps Dropdown in a `relative` container.
        // Content is absolutely-positioned relative to that.
        style={{ top: `calc(100% + ${sideOffset}px)` }}
        className={cn(
          "absolute z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-card p-1 text-card-foreground shadow-lg",
          align === "end" ? "right-0" : "left-0",
          className
        )}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </div>
    );
  }
);
DropdownContent.displayName = "DropdownContent";

interface DropdownItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Called when the item is activated (click or Enter/Space). The menu closes after. */
  onSelect?: () => void;
  disabled?: boolean;
}

const DropdownItem = forwardRef<HTMLButtonElement, DropdownItemProps>(
  ({ className, onSelect, disabled, onClick, onKeyDown, children, ...props }, ref) => {
    const ctx = useDropdownContext("DropdownItem");

    const activate = (e: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      onSelect?.();
      ctx.setOpen(false);
      ctx.triggerRef.current?.focus();
      // Best-effort: prevent default to stop accidental form submission.
      e.preventDefault();
    };

    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        data-disabled={disabled ? "true" : undefined}
        aria-disabled={disabled || undefined}
        tabIndex={-1}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left text-foreground",
          "outline-none transition-colors duration-100",
          "hover:bg-accent hover:text-accent-foreground",
          "focus:bg-accent focus:text-accent-foreground",
          "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
          className
        )}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) activate(e);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") activate(e);
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);
DropdownItem.displayName = "DropdownItem";

function DropdownSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn("my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}

function DropdownLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownLabel,
};
export type {
  DropdownProps,
  DropdownTriggerProps,
  DropdownContentProps,
  DropdownItemProps,
};

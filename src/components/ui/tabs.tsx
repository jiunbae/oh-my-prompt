"use client";

/**
 * Tabs — hand-rolled, ARIA-conformant.
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabsList aria-label="Sections">
 *       <TabsTrigger value="a">A</TabsTrigger>
 *       <TabsTrigger value="b">B</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="a">…</TabsContent>
 *     <TabsContent value="b">…</TabsContent>
 *   </Tabs>
 *
 * Behaviour
 * - `role="tablist" | "tab" | "tabpanel"` and `aria-selected`/`aria-controls`
 * - Roving tabindex: only the active tab is in the tab order; arrow keys move
 *   focus + selection (Home/End jump to first/last)
 * - Each tab's id and panel's id are derived from a shared base id (useId)
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (next: string) => void;
  baseId: string;
  registerTrigger: (value: string, el: HTMLButtonElement | null) => void;
  focusByValue: (value: string) => void;
  orderedValues: () => string[];
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string) {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Tabs>.`);
  }
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (next: string) => void;
  children: ReactNode;
  className?: string;
}

function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  // Map of value -> trigger element. Use a ref so updates don't re-render.
  const triggerMap = useRef(new Map<string, HTMLButtonElement>());
  // Track insertion order so arrow-keys cycle in DOM order.
  const order = useRef<string[]>([]);

  const registerTrigger = useCallback(
    (val: string, el: HTMLButtonElement | null) => {
      if (el) {
        triggerMap.current.set(val, el);
        if (!order.current.includes(val)) order.current.push(val);
      } else {
        triggerMap.current.delete(val);
        order.current = order.current.filter((v) => v !== val);
      }
    },
    []
  );

  const focusByValue = useCallback(
    (val: string) => {
      const el = triggerMap.current.get(val);
      if (el) el.focus();
    },
    []
  );

  const orderedValues = useCallback(() => [...order.current], []);

  const ctx = useMemo<TabsContextValue>(
    () => ({
      value,
      setValue: onValueChange,
      baseId,
      registerTrigger,
      focusByValue,
      orderedValues,
    }),
    [value, onValueChange, baseId, registerTrigger, focusByValue, orderedValues]
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

type TabsListProps = HTMLAttributes<HTMLDivElement>;

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="tablist"
        className={cn(
          "inline-flex items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsList.displayName = "TabsList";

interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, children, onClick, onKeyDown, ...props }, forwardedRef) => {
    const ctx = useTabsContext("TabsTrigger");
    const selected = ctx.value === value;
    const tabId = `${ctx.baseId}-tab-${value}`;
    const panelId = `${ctx.baseId}-panel-${value}`;

    const handleRef = useCallback(
      (el: HTMLButtonElement | null) => {
        ctx.registerTrigger(value, el);
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      },
      [ctx, value, forwardedRef]
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      const values = ctx.orderedValues();
      const idx = values.indexOf(value);
      if (idx === -1) return;

      let next: string | null = null;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = values[(idx + 1) % values.length];
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = values[(idx - 1 + values.length) % values.length];
          break;
        case "Home":
          next = values[0];
          break;
        case "End":
          next = values[values.length - 1];
          break;
        default:
          return;
      }
      if (next !== null) {
        e.preventDefault();
        ctx.setValue(next);
        // Defer focus so the re-render lands first.
        requestAnimationFrame(() => ctx.focusByValue(next!));
      }
    };

    return (
      <button
        ref={handleRef}
        type="button"
        role="tab"
        id={tabId}
        aria-selected={selected}
        aria-controls={panelId}
        tabIndex={selected ? 0 : -1}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) ctx.setValue(value);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium",
          "transition-colors duration-150",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          selected
            ? "bg-card text-foreground shadow-sm"
            : "hover:text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  /** When false (default) the inactive panel is unmounted. */
  forceMount?: boolean;
}

const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, forceMount = false, children, ...props }, ref) => {
    const ctx = useTabsContext("TabsContent");
    const selected = ctx.value === value;
    if (!selected && !forceMount) return null;

    const tabId = `${ctx.baseId}-tab-${value}`;
    const panelId = `${ctx.baseId}-panel-${value}`;

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId}
        hidden={!selected}
        tabIndex={0}
        className={cn(
          "mt-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
export type { TabsProps, TabsTriggerProps, TabsContentProps };

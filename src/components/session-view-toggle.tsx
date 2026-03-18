"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useTransition } from "react";

export type ViewMode = "list" | "grid" | "timeline";

interface SessionViewToggleProps {
  currentView: ViewMode;
}

export function SessionViewToggle({ currentView }: SessionViewToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setView = useCallback(
    (view: ViewMode) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (view === "list") {
        params.delete("view");
      } else {
        params.set("view", view);
      }
      params.delete("page");
      const qs = params.toString();
      startTransition(() => {
        router.push(`${pathname}${qs ? `?${qs}` : ""}`);
      });
    },
    [router, pathname, searchParams, startTransition]
  );

  const views: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
    {
      value: "list",
      label: "List view",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      ),
    },
    {
      value: "grid",
      label: "Grid view",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      ),
    },
    {
      value: "timeline",
      label: "Timeline view",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="View mode">
      {views.map((v) => (
        <button
          key={v.value}
          type="button"
          onClick={() => setView(v.value)}
          disabled={isPending}
          aria-label={v.label}
          aria-pressed={currentView === v.value}
          className={`inline-flex items-center justify-center px-3 py-2 text-sm transition-colors ${
            currentView === v.value
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          {v.icon}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Button } from "@/components/ui/button";

interface DatePreset {
  label: string;
  value: string;
  days: number;
}

const DATE_PRESETS: DatePreset[] = [
  { label: "7d", value: "7", days: 7 },
  { label: "30d", value: "30", days: 30 },
  { label: "90d", value: "90", days: 90 },
  { label: "365d", value: "365", days: 365 },
];

interface AnalyticsFiltersProps {
  currentRange: string;
  currentFrom?: string;
  currentTo?: string;
  currentProject?: string;
  projects: Array<{ project: string; count: number }>;
}

export function AnalyticsFilters({
  currentRange,
  currentFrom,
  currentTo,
  currentProject,
  projects,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const createQueryString = useCallback(
    (params: Record<string, string | undefined>) => {
      const current = new URLSearchParams(Array.from(searchParams.entries()));
      Object.entries(params).forEach(([key, value]) => {
        if (value) {
          current.set(key, value);
        } else {
          current.delete(key);
        }
      });
      return current.toString();
    },
    [searchParams]
  );

  const navigate = useCallback(
    (params: Record<string, string | undefined>) => {
      startTransition(() => {
        const qs = createQueryString(params);
        router.push(pathname + (qs ? "?" + qs : ""));
      });
    },
    [createQueryString, pathname, router]
  );

  const handlePresetClick = (preset: DatePreset) => {
    navigate({
      range: preset.value === "30" ? undefined : preset.value,
      from: undefined,
      to: undefined,
    });
  };

  const handleCustomDate = (key: "from" | "to", value: string) => {
    navigate({
      range: "custom",
      [key]: value || undefined,
    });
  };

  const handleProjectChange = (value: string) => {
    navigate({ project: value || undefined });
  };

  const isCustom = currentRange === "custom";

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center gap-3 ${isPending ? "opacity-70" : ""}`}
    >
      {/* Date range presets */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground font-medium mr-1">
          Period:
        </span>
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => handlePresetClick(preset)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                !isCustom && currentRange === preset.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              navigate({
                range: "custom",
                from: currentFrom ?? undefined,
                to: currentTo ?? undefined,
              })
            }
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              isCustom
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {/* Custom date inputs */}
      {isCustom && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={currentFrom ?? ""}
            onChange={(e) => handleCustomDate("from", e.target.value)}
            className="px-2 py-1 bg-input-bg border border-border rounded-md text-foreground text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={currentTo ?? ""}
            onChange={(e) => handleCustomDate("to", e.target.value)}
            className="px-2 py-1 bg-input-bg border border-border rounded-md text-foreground text-xs"
          />
        </div>
      )}

      {/* Project filter */}
      {projects.length > 0 && (
        <div className="flex items-center gap-1 sm:ml-auto">
          <label
            htmlFor="analytics-project-filter"
            className="text-xs text-muted-foreground font-medium"
          >
            Project:
          </label>
          <select
            id="analytics-project-filter"
            value={currentProject ?? ""}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="px-2 py-1 bg-input-bg border border-border rounded-md text-foreground text-xs min-w-[120px]"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.project} value={p.project}>
                {p.project} ({p.count})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

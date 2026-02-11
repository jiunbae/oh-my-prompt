"use client";

import { useState, useRef, useCallback } from "react";

interface ActivityData {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  data: ActivityData[];
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  count: number;
  dayOfWeek: string;
}

function formatTooltipDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getDayOfWeek(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    date: "",
    count: 0,
    dayOfWeek: "",
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, day: { date: string; count: number; inRange: boolean }) => {
      if (!day.inRange || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const tileRect = (e.target as HTMLElement).getBoundingClientRect();
      setTooltip({
        visible: true,
        x: tileRect.left - rect.left + tileRect.width / 2,
        y: tileRect.top - rect.top - 4,
        date: day.date,
        count: day.count,
        dayOfWeek: getDayOfWeek(day.date),
      });
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No activity data</p>;
  }

  const countMap = new Map(data.map((d) => [d.date, d.count]));
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const totalPrompts = data.reduce((sum, d) => sum + d.count, 0);
  const activeDays = data.filter((d) => d.count > 0).length;

  // Build full calendar grid
  const sortedDates = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const startDate = new Date(sortedDates[0].date + "T12:00:00Z");
  const endDate = new Date(sortedDates[sortedDates.length - 1].date + "T12:00:00Z");

  const gridStart = new Date(startDate);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());

  const gridEnd = new Date(endDate);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const days: Array<{ date: string; count: number; inRange: boolean }> = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const dateStr = cursor.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      count: countMap.get(dateStr) ?? 0,
      inRange: cursor >= startDate && cursor <= endDate,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Month labels
  const monthLabels: Array<{ label: string; colIndex: number }> = [];
  let lastMonth = "";
  weeks.forEach((week, colIdx) => {
    const refDay = week.find((d) => d.inRange) ?? week[0];
    const month = new Date(refDay.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short" });
    if (month !== lastMonth) {
      monthLabels.push({ label: month, colIndex: colIdx });
      lastMonth = month;
    }
  });

  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

  const getColor = (count: number, inRange: boolean) => {
    if (!inRange) return "bg-transparent";
    if (count === 0) return "bg-secondary/50 dark:bg-secondary/30";
    if (count < maxCount * 0.25) return "bg-green-200 dark:bg-green-900/60";
    if (count < maxCount * 0.5) return "bg-green-400 dark:bg-green-700/80";
    if (count < maxCount * 0.75) return "bg-green-500 dark:bg-green-500";
    return "bg-green-600 dark:bg-green-400";
  };

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="bg-foreground text-background rounded-md px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap">
            <p className="font-medium">
              {tooltip.count === 0
                ? "No prompts"
                : `${tooltip.count} prompt${tooltip.count !== 1 ? "s" : ""}`}
            </p>
            <p className="text-background/70 text-[10px]">{formatTooltipDate(tooltip.date)}</p>
          </div>
          {/* Arrow */}
          <div
            className="w-2 h-2 bg-foreground rotate-45 mx-auto -mt-1"
          />
        </div>
      )}

      {/* Month labels row */}
      <div className="flex">
        <div className="w-8 shrink-0" />
        <div className="flex gap-[3px] relative">
          {weeks.map((_, colIdx) => {
            const ml = monthLabels.find((m) => m.colIndex === colIdx);
            return (
              <div key={colIdx} className="w-[13px] text-[10px] text-muted-foreground">
                {ml ? ml.label : ""}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid: 7 rows x N columns */}
      <div className="flex">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-[3px] w-8 shrink-0">
          {dayLabels.map((label, i) => (
            <div key={i} className="h-[13px] text-[10px] text-muted-foreground leading-[13px]">
              {label}
            </div>
          ))}
        </div>

        {/* Tile grid */}
        <div className="flex gap-[3px]">
          {weeks.map((week, colIdx) => (
            <div key={colIdx} className="flex flex-col gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.date}
                  className={`w-[13px] h-[13px] rounded-sm ${getColor(day.count, day.inRange)} transition-colors ${
                    day.inRange ? "hover:ring-1 hover:ring-foreground/40 cursor-pointer" : ""
                  }`}
                  onMouseEnter={(e) => handleMouseEnter(e, day)}
                  onMouseLeave={handleMouseLeave}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
        <span>
          {totalPrompts.toLocaleString()} prompts in {activeDays} active day{activeDays !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          <div className="w-[10px] h-[10px] rounded-sm bg-secondary/50 dark:bg-secondary/30" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-200 dark:bg-green-900/60" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-400 dark:bg-green-700/80" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-500 dark:bg-green-500" />
          <div className="w-[10px] h-[10px] rounded-sm bg-green-600 dark:bg-green-400" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

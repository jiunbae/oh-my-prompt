"use client";

import { useId } from "react";
import { useLocale } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartEmpty, chartColors, chartTooltipStyles } from "./_chart-helpers";

interface PromptVolumeChartProps {
  data: Array<{ date: string; count: number }>;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Tooltip series label (e.g. "Count"). */
  tooltipLabel?: string;
  /** Format the raw value into the tooltip's value text (e.g. "{n} prompts"). */
  formatTooltipValue?: (value: number | string | undefined) => string;
}

export function PromptVolumeChart({
  data,
  isLoading,
  emptyMessage = "No prompt volume data",
  tooltipLabel = "Count",
  formatTooltipValue,
}: PromptVolumeChartProps) {
  const locale = useLocale();
  const id = useId();
  const gradientId = `colorVolume-${id}`;

  if (isLoading) {
    return (
      <div className="h-[280px] w-full" role="status" aria-label="Loading prompt volume chart">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return <ChartEmpty message={emptyMessage} />;
  }

  const formattedData = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date + "T12:00:00Z").toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    }),
  }));

  const tooltipStyles = chartTooltipStyles();
  const total = formattedData.reduce((sum, item) => sum + item.count, 0);
  const summary = `Prompt volume chart with ${total} prompts across ${formattedData.length} days, from ${formattedData[0].displayDate} to ${formattedData[formattedData.length - 1].displayDate}.`;

  return (
    <div className="h-[280px] w-full">
      <div className="h-full w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formattedData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
          <XAxis
            dataKey="displayDate"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            minTickGap={30}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={tooltipStyles.contentStyle}
            labelStyle={tooltipStyles.labelStyle}
            itemStyle={tooltipStyles.itemStyle}
            formatter={(value: number | string | undefined) => [
              formatTooltipValue ? formatTooltipValue(value) : `${value ?? 0} prompts`,
              tooltipLabel,
            ]}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={chartColors.primary}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#${gradientId})`}
          />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Prompt volume by date</caption>
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Prompts</th></tr>
        </thead>
        <tbody>
          {formattedData.map((item) => (
            <tr key={item.date}><th scope="row">{item.displayDate}</th><td>{item.count}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

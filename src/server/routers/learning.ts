import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  computeWeeklyMetrics,
  computeWeeklyMetricsBatch,
  getImprovementSuggestions,
  weekStartKeyForDate,
} from "@/lib/learning-metrics";
import { addDaysToDateKey } from "@/lib/date-utils";

export const learningRouter = createTRPCRouter({
  weeklyReport: protectedProcedure
    .input(
      z.object({
        weekStart: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
      }),
    )
    .query(async ({ input, ctx }) => {
      const weekStart = new Date(input.weekStart);
      const metrics = await computeWeeklyMetrics(ctx.user.id, weekStart);
      const suggestions = getImprovementSuggestions(metrics);
      return { metrics, suggestions };
    }),

  trend: protectedProcedure
    .input(
      z.object({
        weeks: z.number().int().min(1).max(52).default(4),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Compute week-start keys with the SAME APP_TIME_ZONE-aware Monday
      // convention used to bucket prompts inside computeWeeklyMetricsBatch, so
      // request keys and bucket keys always align (even off UTC).
      const currentWeekKey = weekStartKeyForDate(new Date());

      const weekStartKeys: string[] = [];
      for (let i = input.weeks - 1; i >= 0; i--) {
        weekStartKeys.push(addDaysToDateKey(currentWeekKey, -i * 7));
      }

      // Single batch query instead of N+1 loop
      return computeWeeklyMetricsBatch(ctx.user.id, weekStartKeys);
    }),
});

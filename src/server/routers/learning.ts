import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  computeWeeklyMetrics,
  computeWeeklyMetricsBatch,
  getImprovementSuggestions,
} from "@/lib/learning-metrics";

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
      const now = new Date();
      // Start from the most recent Monday
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
      const currentMonday = new Date(now);
      currentMonday.setDate(now.getDate() - diff);
      currentMonday.setHours(0, 0, 0, 0);

      const weekStarts = [];
      for (let i = input.weeks - 1; i >= 0; i--) {
        const weekStart = new Date(currentMonday);
        weekStart.setDate(currentMonday.getDate() - i * 7);
        weekStarts.push(weekStart);
      }

      // Single batch query instead of N+1 loop
      return computeWeeklyMetricsBatch(ctx.user.id, weekStarts);
    }),
});

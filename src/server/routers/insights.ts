import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  getCachedInsight,
  getUserInsights,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";
import { getExtension } from "@/extensions/registry";
import type { InsightResult } from "@/extensions/types";

export const insightsRouter = createTRPCRouter({
  /** Get all cached insights for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    return getUserInsights(ctx.user.id);
  }),

  /** Get a specific cached insight by type */
  get: protectedProcedure
    .input(z.object({ type: z.string() }))
    .query(async ({ ctx, input }) => {
      return getCachedInsight(ctx.user.id, input.type);
    }),

  /** Generate (or refresh) an insight on-demand */
  generate: protectedProcedure
    .input(
      z.object({
        type: z.string(),
        dateRange: z
          .object({
            from: z.string(),
            to: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ext = getExtension(input.type);
      if (!ext?.processor) {
        throw new Error(`Extension "${input.type}" not found or has no processor`);
      }

      const now = new Date();
      const defaultFrom = new Date(now);
      defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 7);

      const dateRange = input.dateRange || {
        from: defaultFrom.toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
      };

      const processorInput = {
        userId: ctx.user.id,
        dateRange,
      };

      const result: InsightResult = await ext.processor.handler(processorInput);

      await cacheInsight(ctx.user.id, input.type, result, {
        dataHash: hashData(processorInput),
        ttlHours: ext.name.includes("weekly") ? 168 : 24,
      });

      return result;
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  getCachedInsight,
  getUserInsights,
  cacheInsight,
  hashData,
} from "@/extensions/insight-cache";
import { getExtension } from "@/extensions/registry";
import type { InsightResult } from "@/extensions/types";
import { getLastNDaysRange } from "@/lib/date-utils";
import { getRequestLocale } from "@/i18n/server-locale";

export const insightsRouter = createTRPCRouter({
  /** Get all cached insights for the current user (scoped to their locale) */
  list: protectedProcedure.query(async ({ ctx }) => {
    const locale = await getRequestLocale(ctx.headers);
    return getUserInsights(ctx.user.id, locale);
  }),

  /** Get a specific cached insight by type */
  get: protectedProcedure
    .input(z.object({ type: z.string() }))
    .query(async ({ ctx, input }) => {
      const locale = await getRequestLocale(ctx.headers);
      return getCachedInsight(ctx.user.id, input.type, locale);
    }),

  /** Generate (or refresh) an insight on-demand */
  generate: protectedProcedure
    .input(
      z.object({
        type: z.string(),
        dateRange: z
          .object({
            from: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
            to: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ext = getExtension(input.type);
      if (!ext?.processor) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Extension "${input.type}" not found or has no processor`,
        });
      }

      const locale = await getRequestLocale(ctx.headers);
      const defaultRange = getLastNDaysRange(ext.processor.defaultRangeDays ?? 7);

      const dateRange = input.dateRange || {
        from: defaultRange.fromKey,
        to: defaultRange.toKey,
      };

      const processorInput = {
        userId: ctx.user.id,
        dateRange,
        locale,
      };

      const result: InsightResult = await ext.processor.handler(processorInput);

      await cacheInsight(ctx.user.id, input.type, result, {
        dataHash: hashData(processorInput),
        ttlHours: ext.cacheTtlHours ?? 24,
        locale,
      });

      return result;
    }),
});

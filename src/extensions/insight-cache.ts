import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sql, and, eq, gt, type SQL } from "drizzle-orm";
import { createHash } from "crypto";
import { defaultLocale } from "@/i18n/config";
import type { InsightResult } from "./types";

/** Hash input data to detect staleness */
export function hashData(data: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Build a condition matching cached rows for a given locale. Insights are
 * scoped per-locale via `parameters.locale` so an English and a Korean copy
 * of the same insight type can coexist. Legacy rows (written before locale
 * scoping, with no `parameters.locale`) are treated as the default locale.
 */
function localeCondition(locale?: string): SQL | undefined {
  if (!locale) return undefined;
  if (locale === defaultLocale) {
    return sql`(${schema.aiInsights.parameters} ->> 'locale' = ${locale} OR ${schema.aiInsights.parameters} ->> 'locale' IS NULL)`;
  }
  return sql`${schema.aiInsights.parameters} ->> 'locale' = ${locale}`;
}

/** Get a cached insight if it exists and is not expired */
export async function getCachedInsight(
  userId: string,
  insightType: string,
  locale?: string,
): Promise<InsightResult | null> {

  const conditions = [
    eq(schema.aiInsights.userId, userId),
    eq(schema.aiInsights.insightType, insightType),
    gt(schema.aiInsights.expiresAt, new Date()),
  ];

  const localeCond = localeCondition(locale);
  if (localeCond) conditions.push(localeCond);

  const [row] = await db
    .select({ result: schema.aiInsights.result })
    .from(schema.aiInsights)
    .where(and(...conditions))
    .orderBy(sql`generated_at DESC`)
    .limit(1);

  return row ? (row.result as InsightResult) : null;
}

/** Store a generated insight in the cache */
export async function cacheInsight(
  userId: string,
  insightType: string,
  result: InsightResult,
  options: {
    parameters?: Record<string, unknown>;
    dataHash: string;
    model?: string;
    tokensUsed?: number;
    ttlHours?: number;
    /** Locale this insight was generated for. Scopes the cache per-language. */
    locale?: string;
  },
): Promise<void> {
  const ttl = options.ttlHours ?? 24;
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

  // Persist the locale alongside any caller parameters so reads can scope by it.
  const parameters = options.locale
    ? { ...(options.parameters || {}), locale: options.locale }
    : options.parameters || {};

  // Only evict the same-locale copy so other languages of this insight survive.
  const localeCond = localeCondition(options.locale);

  // Atomic delete+insert in a transaction to prevent race conditions
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.aiInsights)
      .where(
        and(
          eq(schema.aiInsights.userId, userId),
          eq(schema.aiInsights.insightType, insightType),
          ...(localeCond ? [localeCond] : []),
        ),
      );

    await tx.insert(schema.aiInsights).values({
      userId,
      insightType,
      parameters,
      dataHash: options.dataHash,
      result: result as unknown as Record<string, unknown>,
      model: options.model,
      tokensUsed: options.tokensUsed,
      expiresAt,
    });
  });
}

/** Delete expired insights */
export async function cleanExpiredInsights(): Promise<number> {
  const result = await db
    .delete(schema.aiInsights)
    .where(sql`${schema.aiInsights.expiresAt} < now()`)
    .returning({ id: schema.aiInsights.id });
  return result.length;
}

/** Get all cached insights for a user, optionally scoped to a locale */
export async function getUserInsights(
  userId: string,
  locale?: string,
): Promise<Array<{ id: string; type: string; result: InsightResult; generatedAt: Date }>> {
  const localeCond = localeCondition(locale);
  const rows = await db
    .select({
      id: schema.aiInsights.id,
      type: schema.aiInsights.insightType,
      result: schema.aiInsights.result,
      generatedAt: schema.aiInsights.generatedAt,
    })
    .from(schema.aiInsights)
    .where(
      and(
        eq(schema.aiInsights.userId, userId),
        gt(schema.aiInsights.expiresAt, new Date()),
        // Free-form "Ask Your Data" answers are recalled via the Ask panel's
        // recent questions, not this list — keep them out of Recent Insights.
        sql`${schema.aiInsights.insightType} NOT LIKE 'ask:%'`,
        ...(localeCond ? [localeCond] : []),
      ),
    )
    .orderBy(sql`generated_at DESC`);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    result: r.result as InsightResult,
    generatedAt: r.generatedAt,
  }));
}

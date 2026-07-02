import { logger } from "@/lib/logger";
import { refreshDailyAggregations } from "@/lib/analytics-cache";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import type { UploadRecord, UploadResult } from "./upload-types";
import { postprocessUploadRecordForDb } from "./upload-postprocess";
import { computeHeuristicScore } from "@/extensions/prompt-quality/processor";
import { scorePrompt } from "@/services/quality-scorer";
import { lintPrompt } from "@/lib/prompt-lint";
import { sql, inArray, eq, and, desc, isNull } from "drizzle-orm";
import { env } from "@/env";
import { dispatchWebhook } from "@/services/webhook";
import { generateEmbedding } from "@/lib/embedding";
import { notifySlack } from "@/lib/slack";
import { triggerEventBatch } from "@/lib/integration-triggers";
import { dateKeyInTimeZone, startOfDateKeyInTimeZone } from "@/lib/date-utils";
import crypto from "crypto";

export type { UploadRecord, UploadResult } from "./upload-types";

function sanitizeEventId(eventId: string): string {
  // Allowlist: only alphanumeric, hyphens, and underscores
  return eventId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildEventKey(userToken: string, createdAt: Date, eventId: string): string {
  const yyyy = createdAt.getUTCFullYear();
  const mm = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(createdAt.getUTCDate()).padStart(2, "0");
  const safeId = sanitizeEventId(eventId);
  return `${userToken}/${yyyy}/${mm}/${dd}/${safeId}.json`;
}

/** A validated+processed record ready for DB insert or duplicate-update. */
interface PreparedRecord {
  eventKey: string;
  dateStr: string;
  createdAt: Date;
  record: UploadRecord;
  processed: ReturnType<typeof postprocessUploadRecordForDb>;
  promptType: string;
}

export async function processUpload(
  records: UploadRecord[],
  userId: string,
  userToken: string,
  deviceId?: string,
  teamId?: string,
): Promise<UploadResult> {
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];
  const affectedDates = new Set<string>();

  const redactEnabled = env.OMP_UPLOAD_REDACT_ENABLED !== "false";
  const redactMask = env.OMP_UPLOAD_REDACT_MASK;

  // ── Phase 1: Validate & prepare all records in memory ──────────

  const preparedRaw: PreparedRecord[] = [];

  for (const record of records) {
    if (!record.event_id || !record.created_at) {
      rejected++;
      errors.push(`Invalid record: missing required fields (event_id, created_at)`);
      continue;
    }

    if (!record.prompt_text || !record.prompt_text.trim()) {
      duplicates++; // Skip silently, count as duplicate to advance sync state
      continue;
    }

    const createdAt = new Date(record.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      rejected++;
      errors.push(`Invalid record ${record.event_id}: created_at is not a valid date`);
      continue;
    }

    const processed = postprocessUploadRecordForDb(record, {
      redactEnabled,
      redactMask,
    });

    const eventKey = buildEventKey(userToken, createdAt, record.event_id);
    // Key affected days by APP_TIME_ZONE calendar day (not UTC) so the daily
    // analytics recompute in phase 7 covers the same local-day groups that
    // analytics-cache aggregates by `AT TIME ZONE APP_TIME_ZONE`.
    const dateStr = dateKeyInTimeZone(createdAt);

    const promptType = processed.promptText.includes("<task-notification>")
      ? "task_notification"
      : processed.promptText.includes("<system-reminder>")
        ? "system"
        : "user_input";

    preparedRaw.push({ eventKey, dateStr, createdAt, record, processed, promptType });
  }

  // De-duplicate records that share an event_id within THIS payload (they map to
  // the same eventKey). Without this, two same-key rows would both be routed to
  // the insert path; onConflictDoNothing would silently drop the second, but we
  // would still count it as accepted and try to attach its tool invocations to a
  // prompt id that was never inserted (FK-dangling). Keep the last occurrence so
  // the freshest response/tool data wins; count the earlier ones as duplicates.
  const dedupMap = new Map<string, PreparedRecord>();
  for (const item of preparedRaw) {
    if (dedupMap.has(item.eventKey)) duplicates++;
    dedupMap.set(item.eventKey, item);
  }
  const prepared: PreparedRecord[] = [...dedupMap.values()];

  if (prepared.length === 0) {
    return {
      success: errors.length === 0,
      accepted,
      duplicates,
      rejected,
      errors: errors.slice(0, 10),
    };
  }

  // ── Phase 2: Batch-fetch existing eventKeys ────────────────────

  const allEventKeys = prepared.map((p) => p.eventKey);

  // Query in chunks of 500 to avoid overly-large IN clauses
  const QUERY_CHUNK = 500;
  const existingMap = new Map<string, string>(); // eventKey -> prompt id

  for (let i = 0; i < allEventKeys.length; i += QUERY_CHUNK) {
    const chunk = allEventKeys.slice(i, i + QUERY_CHUNK);
    const rows = await db
      .select({ id: schema.prompts.id, eventKey: schema.prompts.eventKey })
      .from(schema.prompts)
      .where(inArray(schema.prompts.eventKey, chunk));

    for (const row of rows) {
      existingMap.set(row.eventKey, row.id);
    }
  }

  // ── Phase 3: Separate new inserts vs. duplicate updates ────────

  const toInsert: PreparedRecord[] = [];
  const toUpdate: Array<PreparedRecord & { existingId: string }> = [];

  for (const item of prepared) {
    const existingId = existingMap.get(item.eventKey);
    if (existingId) {
      toUpdate.push({ ...item, existingId });
    } else {
      toInsert.push(item);
    }
  }

  // ── Phase 4: Batch-update duplicates that have new response data ──

  // For duplicates with a response, update them in parallel (small batches)
  const UPDATE_BATCH = 100;
  const updatesWithResponse = toUpdate.filter((u) => u.processed.responseText);

  for (let i = 0; i < updatesWithResponse.length; i += UPDATE_BATCH) {
    const batch = updatesWithResponse.slice(i, i + UPDATE_BATCH);
    await Promise.all(
      batch.map((item) =>
        db
          .update(schema.prompts)
          .set({
            responseText: item.processed.responseText,
            responseLength: item.processed.responseLength,
            tokenEstimateResponse: item.processed.tokenEstimateResponse,
            wordCountResponse: item.processed.wordCountResponse,
            updatedAt: sql`now()`,
          })
          .where(sql`${schema.prompts.id} = ${item.existingId}`),
      ),
    );
    for (const item of batch) {
      affectedDates.add(item.dateStr);
    }
  }

  duplicates += toUpdate.length;

  // Tools attached to already-existing prompts (e.g. a later Stop-hook sync
  // brings tool_use blocks the original UserPromptSubmit upload didn't have).
  await persistToolInvocations(
    toUpdate.map((item) => ({ record: item.record, promptId: item.existingId, createdAt: item.createdAt })),
    userId,
    teamId,
  );

  // ── Phase 5: Batch-insert new records ──────────────────────────

  // Determine default visibility if teamId is provided
  let defaultVisibility: "private" | "team" | "public" = "private";
  if (teamId) {
    const [teamSettings] = await db
      .select({ defaultPromptVisibility: schema.teamSettings.defaultPromptVisibility })
      .from(schema.teamSettings)
      .where(eq(schema.teamSettings.teamId, teamId))
      .limit(1);
    const vis = teamSettings?.defaultPromptVisibility;
    if (vis === "private" || vis === "team" || vis === "public") {
      defaultVisibility = vis;
    } else {
      defaultVisibility = "team";
    }
  }

  if (toInsert.length > 0) {
    // Compute heuristic scores in memory first
    const insertValues = toInsert.map((item) => {
      const isUserInput = item.promptType === "user_input";
      const heuristic = isUserInput
        ? computeHeuristicScore(item.processed.promptText, {
            hasContext: !!(item.record.project || item.record.cwd),
          })
        : null;
      const dims = isUserInput
        ? scorePrompt(item.processed.promptText)
        : null;
      const lintResults = isUserInput
        ? lintPrompt(item.processed.promptText)
        : null;

      return {
        id: crypto.randomUUID(),
        eventKey: item.eventKey,
        timestamp: item.createdAt,
        workingDirectory: item.record.cwd || "unknown",
        promptLength: item.processed.promptLength,
        promptText: item.processed.promptText,
        responseText: item.processed.responseText,
        responseLength: item.processed.responseLength,
        projectName:
          item.record.project ||
          (item.record.cwd ? item.record.cwd.split("/").pop() || null : null),
        promptType: item.promptType,
        userId,
        teamId: teamId || undefined,
        source: item.record.source || undefined,
        sessionId: item.record.session_id || undefined,
        deviceName: deviceId || undefined,
        visibility: teamId ? defaultVisibility : undefined,
        tokenEstimate: item.processed.tokenEstimate,
        wordCount: item.processed.wordCount,
        tokenEstimateResponse: item.processed.tokenEstimateResponse,
        wordCountResponse: item.processed.wordCountResponse,
        searchVector: sql`to_tsvector('english', ${item.processed.promptText} || ' ' || ${item.processed.responseText ?? ""})`,
        // Inline heuristic enrichment for user_input prompts
        ...(dims
          ? {
              qualityScore: dims.overall,
              qualityClarity: dims.clarity,
              qualitySpecificity: dims.specificity,
              qualityContext: dims.context,
              qualityConstraints: dims.constraints,
              qualityStructure: dims.structure,
              qualityDetails: {
                method: "heuristic-v1",
                ...dims,
                lint: lintResults ?? [],
              },
              topicTags: heuristic?.topicTags,
              enrichedAt: new Date(),
            }
          : {}),
      };
    });

    // Track which rows were ACTUALLY inserted (eventKey -> new prompt id) via
    // RETURNING. onConflictDoNothing skips existing eventKeys, so the returned
    // rows are exactly the newly-created prompts — the only rows we should count
    // as accepted and the only rows we may safely parent tool invocations to.
    const insertedById = new Map<string, string>(); // eventKey -> prompt id

    const INSERT_CHUNK = 200;
    for (let i = 0; i < insertValues.length; i += INSERT_CHUNK) {
      const chunk = insertValues.slice(i, i + INSERT_CHUNK);
      try {
        const returned = await db
          .insert(schema.prompts)
          .values(chunk)
          .onConflictDoNothing({ target: schema.prompts.eventKey })
          .returning({ id: schema.prompts.id, eventKey: schema.prompts.eventKey });
        for (const row of returned) insertedById.set(row.eventKey, row.id);
      } catch (error) {
        // If batch insert fails, fall back to individual inserts for this chunk
        // so we can pinpoint the failing records
        for (let j = 0; j < chunk.length; j++) {
          try {
            const returned = await db
              .insert(schema.prompts)
              .values(chunk[j])
              .onConflictDoNothing({ target: schema.prompts.eventKey })
              .returning({ id: schema.prompts.id, eventKey: schema.prompts.eventKey });
            if (returned[0]) insertedById.set(returned[0].eventKey, returned[0].id);
          } catch (innerError) {
            const item = toInsert[i + j];
            rejected++;
            errors.push(
              `Error processing record ${item.record.event_id}: ${innerError instanceof Error ? innerError.message : "Unknown error"}`,
            );
          }
        }
      }
    }

    // Only count and post-process rows that were genuinely inserted.
    accepted += insertedById.size;

    const insertedItems = toInsert.filter((item) => insertedById.has(item.eventKey));

    for (const item of insertedItems) {
      affectedDates.add(item.dateStr);
    }

    // ── Phase 5a: Insert tool_invocations parented to newly-inserted prompts.
    // We pair each inserted item with the id RETURNED for its eventKey, so tool
    // rows never reference a prompt that was skipped by onConflictDoNothing.
    await persistToolInvocations(
      insertedItems.map((item) => ({
        record: item.record,
        promptId: insertedById.get(item.eventKey)!,
        createdAt: item.createdAt,
      })),
      userId,
      teamId,
    );

    // ── Phase 5b: Trigger outgoing integrations for new prompts ────
    // Batched: one integration query + one delivery loop (was N+1), and teamId
    // is threaded through so team-scoped integrations are reachable.
    if (insertedItems.length > 0) {
      triggerEventBatch(
        "prompt.created",
        insertedItems.map((item) => ({
          promptId: insertedById.get(item.eventKey)!,
          promptText: item.processed.promptText,
          projectName:
            item.record.project ||
            (item.record.cwd ? item.record.cwd.split("/").pop() || null : null),
          sessionId: item.record.session_id ?? null,
        })),
        userId,
        teamId,
      ).catch((err) => {
        logger.error({ err }, "Non-blocking integration trigger failed for prompt.created");
      });
    }
  }

  // ── Phase 6: Generate embeddings for new prompts (non-blocking) ─
  if (accepted > 0) {
    generateMissingEmbeddings(userId).catch((err) => {
      logger.error({ err }, "Non-blocking embedding generation failed");
    });
  }

  // ── Phase 7: Refresh daily analytics ───────────────────────────

  if (affectedDates.size > 0) {
    try {
      // affectedDates holds APP_TIME_ZONE day-keys (YYYY-MM-DD). Recompute from
      // the START of the earliest local day so the aggregation covers the whole
      // day, matching analytics-cache's `AT TIME ZONE APP_TIME_ZONE` grouping.
      const earliestKey = [...affectedDates].sort()[0];
      const rangeFrom = startOfDateKeyInTimeZone(earliestKey) ?? new Date(earliestKey);
      await refreshDailyAggregations(userId, rangeFrom);
    } catch (error) {
      logger.error({ err: error }, "Failed to refresh daily analytics aggregations");
    }
  }

  // ── Phase 8: Detect session.completed via gap threshold ───────
  // If the earliest new prompt's session differs from the previous prompt's
  // session by >30 min gap, the old session is considered completed.
  const userInputRecords = toInsert.filter((r) => r.promptType === "user_input");
  if (userInputRecords.length > 0) {
    detectSessionCompleted(userId, userInputRecords).catch((err) => {
      logger.error({ err }, "Non-blocking session.completed detection failed");
    });
  }

  // ── Phase 9: Slack realtime notifications (non-blocking) ──────
  for (const item of userInputRecords) {
    notifySlack(userId, {
      id: item.eventKey,
      promptText: item.processed.promptText,
      projectName:
        item.record.project ||
        (item.record.cwd ? item.record.cwd.split("/").pop() || null : null),
      timestamp: item.createdAt,
    }).catch((err) => {
      logger.error({ err }, "Non-blocking Slack notification failed");
    });
  }

  return {
    success: errors.length === 0,
    accepted,
    duplicates,
    rejected,
    errors: errors.slice(0, 10), // Limit error messages
  };
}

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

async function detectSessionCompleted(
  userId: string,
  newRecords: PreparedRecord[],
): Promise<void> {
  const earliestNew = newRecords.reduce(
    (min, r) => (r.createdAt < min ? r.createdAt : min),
    newRecords[0].createdAt,
  );

  // Get the most recent prompt before the earliest new one
  const [prev] = await db
    .select({
      timestamp: schema.prompts.timestamp,
      sessionId: schema.prompts.sessionId,
    })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.userId, userId),
        sql`${schema.prompts.timestamp} < ${earliestNew.toISOString()}`,
      ),
    )
    .orderBy(desc(schema.prompts.timestamp))
    .limit(1);

  if (!prev) return;

  const gap = earliestNew.getTime() - prev.timestamp.getTime();
  if (gap >= SESSION_GAP_MS && prev.sessionId) {
    dispatchWebhook(userId, "session.completed", {
      sessionId: prev.sessionId,
      endedAt: prev.timestamp.toISOString(),
      gapMinutes: Math.round(gap / 60_000),
    }).catch((err) => {
      logger.error({ err }, "Non-blocking session.completed webhook dispatch failed");
    });
  }
}

async function persistToolInvocations(
  items: Array<{ record: UploadRecord; promptId: string; createdAt: Date }>,
  userId: string,
  teamId?: string,
): Promise<void> {
  const rows: (typeof schema.toolInvocations.$inferInsert)[] = [];

  for (const item of items) {
    const tools = item.record.tools;
    if (!Array.isArray(tools) || tools.length === 0) continue;
    const sessionId = item.record.session_id;
    if (!sessionId) continue; // session_id is NOT NULL in tool_invocations

    for (const t of tools) {
      if (!t || !t.tool_use_id || !t.tool_name) continue;
      const ts = t.created_at ? new Date(t.created_at) : item.createdAt;
      const timestamp = Number.isNaN(ts.getTime()) ? item.createdAt : ts;

      rows.push({
        id: crypto.randomUUID(),
        promptId: item.promptId,
        userId,
        teamId: teamId ?? undefined,
        sessionId,
        sequence: t.sequence ?? 0,
        source: item.record.source ?? undefined,
        toolName: t.tool_name.slice(0, 100),
        toolUseId: t.tool_use_id.slice(0, 255),
        inputJson: t.input ?? undefined,
        program: t.program ? t.program.slice(0, 100) : undefined,
        cwd: t.cwd ?? undefined,
        timestamp,
      });
    }
  }

  if (rows.length === 0) return;

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    try {
      await db
        .insert(schema.toolInvocations)
        .values(chunk)
        .onConflictDoNothing({
          target: [schema.toolInvocations.sessionId, schema.toolInvocations.toolUseId],
        });
    } catch (err) {
      // tool tracking is best-effort; never fail the parent upload
      logger.error({ err, count: chunk.length }, "Failed to insert tool_invocations batch");
    }
  }
}

/**
 * Find prompts without embeddings for a user and generate them.
 * Runs in small batches to avoid overwhelming the embedding API.
 */
async function generateMissingEmbeddings(userId: string): Promise<void> {
  const BATCH_SIZE = 10;

  const rows = await db
    .select({
      id: schema.prompts.id,
      promptText: schema.prompts.promptText,
    })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.userId, userId),
        isNull(schema.prompts.embedding),
        isNull(schema.prompts.deletedAt)
      )
    )
    .limit(BATCH_SIZE);

  if (rows.length === 0) return;

  for (const row of rows) {
    const embedding = await generateEmbedding(row.promptText);
    if (embedding) {
      const vectorLiteral = `[${embedding.join(",")}]`;
      await db.execute(
        sql`UPDATE prompts SET embedding = ${vectorLiteral}::vector WHERE id = ${row.id}`
      );
    }
  }
}

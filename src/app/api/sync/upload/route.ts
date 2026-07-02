import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByToken } from "@/services/sync";
import { processUpload } from "@/services/upload";
import type { UploadRecord } from "@/services/upload";
import { dispatchWebhook } from "@/services/webhook";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { maybeCleanupExpiredShares } from "@/lib/share-cleanup";
import { env } from "@/env";

const MAX_BODY_SIZE = env.OMP_MAX_BODY_SIZE_MB * 1024 * 1024;
const MAX_RECORDS_PER_REQUEST = env.OMP_MAX_RECORDS_PER_REQUEST;

const toolInvocationSchema = z.object({
  tool_use_id: z.string().min(1).max(255),
  tool_name: z.string().min(1).max(100),
  sequence: z.number().int().nonnegative().default(0),
  input: z.unknown().nullish(),
  program: z.string().max(100).nullish(),
  cwd: z.string().max(500).nullish(),
  created_at: z.string().nullish(),
});

const uploadRecordSchema = z.object({
  event_id: z.string().min(1),
  created_at: z.string().min(1),
  prompt_text: z.string(),
  response_text: z.string().nullish(),
  prompt_length: z.number(),
  response_length: z.number().nullish(),
  project: z.string().nullish(),
  cwd: z.string().nullish(),
  source: z.string().nullish(),
  session_id: z.string().nullish(),
  role: z.string().nullish(),
  model: z.string().nullish(),
  cli_name: z.string().nullish(),
  cli_version: z.string().nullish(),
  token_estimate: z.number().nullish(),
  token_estimate_response: z.number().nullish(),
  word_count: z.number().nullish(),
  word_count_response: z.number().nullish(),
  content_hash: z.string().nullish(),
  tools: z.array(toolInvocationSchema).max(1000).optional(),
});

const uploadBodySchema = z.object({
  records: z.array(uploadRecordSchema).max(MAX_RECORDS_PER_REQUEST),
  deviceId: z.string().optional(),
  teamId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Auth via X-User-Token header
    const userToken = request.headers.get("X-User-Token");

    if (!userToken) {
      return NextResponse.json(
        { error: "Authentication required. Provide X-User-Token header." },
        { status: 401 }
      );
    }

    // Look up user by token
    const user = await findUserByToken(userToken);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid user token" },
        { status: 401 }
      );
    }

    const rl = await rateLimiters.api(userToken);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          },
        }
      );
    }

    // Check content length
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      return NextResponse.json(
        { error: `Request body too large. Maximum ${MAX_BODY_SIZE / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    // Parse request body
    let rawBody;
    try {
      const rawText = await request.text();
      if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_SIZE) {
        return NextResponse.json(
          { error: `Request body too large. Maximum ${MAX_BODY_SIZE / 1024 / 1024}MB.` },
          { status: 413 }
        );
      }
      rawBody = JSON.parse(rawText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error({ err: error }, "Failed to parse request body as JSON");
        return NextResponse.json(
          { error: "Invalid JSON in request body" },
          { status: 400 }
        );
      }
      throw error;
    }

    // Validate with Zod
    const parseResult = uploadBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parseResult.error.issues.slice(0, 10) },
        { status: 400 }
      );
    }

    const { records, deviceId, teamId } = parseResult.data;
    const typedRecords = records as UploadRecord[];

    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        errors: [],
      });
    }

    // If teamId provided, verify membership
    if (teamId) {
      const { db } = await import("@/db/client");
      const { teamMembers } = await import("@/db/schema");
      const { eq, and } = await import("drizzle-orm");
      const [membership] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, user.id)
          )
        )
        .limit(1);
      if (!membership) {
        return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
      }
    }

    // Process the upload
    const result = await processUpload(
      typedRecords,
      user.id,
      user.token,
      deviceId,
      teamId,
    );

    if (result.accepted > 0) {
      // Fire webhook notification (non-blocking)
      dispatchWebhook(user.id, "prompt.created", { count: result.accepted }).catch((err) => {
        logger.error({ err, userId: user.id }, "Non-blocking webhook dispatch failed");
      });
    }

    // Piggyback: deactivate expired shares (at most once/hour, non-blocking)
    maybeCleanupExpiredShares();

    return NextResponse.json(result, {
      status: result.success ? 200 : 207, // 207 Multi-Status for partial success
    });
  } catch (error) {
    logger.error({ err: error }, "Upload error");
    return NextResponse.json(
      { error: "An error occurred during upload" },
      { status: 500 }
    );
  }
}

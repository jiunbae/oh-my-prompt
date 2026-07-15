import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, isNull } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import { parseDateTimeOrDateInTimeZone } from "@/lib/date-utils";
import { teamPromptViewConditionForMember } from "@/lib/team-access";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const project = searchParams.get("project") || null;
    const source = searchParams.get("source") || null;
    const from = searchParams.get("from") || null;
    const to = searchParams.get("to") || null;
    const teamIdParam = searchParams.get("teamId")?.trim() || null;
    const parsedTeamId = teamIdParam ? z.string().uuid().safeParse(teamIdParam) : null;
    if (parsedTeamId && !parsedTeamId.success) {
      return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
    }
    const teamId = parsedTeamId?.success ? parsedTeamId.data : null;
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    // Verify team membership if teamId provided
    if (teamId) {
      const [membership] = await db
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, teamId),
            eq(schema.teamMembers.userId, session.userId)
          )
        )
        .limit(1);
      if (!membership) {
        return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
      }
    }

    const conditions = [
      teamId ? eq(schema.prompts.teamId, teamId) : eq(schema.prompts.userId, session.userId),
      sql`${schema.prompts.sessionId} IS NOT NULL`,
      isNull(schema.prompts.deletedAt),
    ];
    if (teamId) {
      conditions.push(teamPromptViewConditionForMember(session.userId));
    }

    if (project) conditions.push(eq(schema.prompts.projectName, project));
    if (source) conditions.push(eq(schema.prompts.source, source));
    if (from) {
      const fromDate = parseDateTimeOrDateInTimeZone(from, "start");
      if (fromDate) conditions.push(gte(schema.prompts.timestamp, fromDate));
    }
    if (to) {
      const toDate = parseDateTimeOrDateInTimeZone(to, "end-exclusive");
      if (toDate) conditions.push(lt(schema.prompts.timestamp, toDate));
    }

    const whereClause = and(...conditions);

    const [sessionsResult, countResult] = await Promise.all([
      db.execute(sql`
        SELECT
          ${schema.prompts.sessionId} as session_id,
          ${schema.prompts.userId} as owner_id,
          CASE
            WHEN ${schema.prompts.userId} = ${session.userId}
            THEN ${schema.sessionDisplayNames.displayName}
            ELSE NULL
          END as display_name,
          MIN(${schema.prompts.timestamp}) as started_at,
          MAX(${schema.prompts.timestamp}) as ended_at,
          COUNT(*)::int as prompt_count,
          COUNT(${schema.prompts.responseText})::int as response_count,
          (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
          (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
          (array_agg(${schema.prompts.deviceName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as device_name,
          LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 200) as first_prompt,
          SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
        FROM ${schema.prompts}
        LEFT JOIN ${schema.sessionDisplayNames}
          ON ${schema.sessionDisplayNames.userId} = ${session.userId}
         AND ${schema.sessionDisplayNames.sessionId} = ${schema.prompts.sessionId}
        WHERE ${whereClause}
        GROUP BY ${schema.prompts.userId}, ${schema.prompts.sessionId}, ${schema.sessionDisplayNames.displayName}
        ORDER BY MAX(${schema.prompts.timestamp}) DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT (${schema.prompts.userId}, ${schema.prompts.sessionId}))::int as count
        FROM ${schema.prompts}
        WHERE ${whereClause}
      `),
    ]);

    const sRows = extractRows(sessionsResult);
    const cRows = extractRows(countResult);

    return NextResponse.json({
      sessions: sRows.map((row) => ({
        sessionId: row.session_id,
        ownerId: row.owner_id,
        teamId,
        displayName: row.display_name,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        promptCount: row.prompt_count,
        responseCount: row.response_count,
        projectName: row.project_name,
        source: row.source,
        deviceName: row.device_name,
        firstPrompt: row.first_prompt,
        totalTokens: row.total_tokens,
      })),
      totalCount: Number(cRows[0]?.count ?? 0),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Sessions API error");
    return NextResponse.json(
      { error: "Failed to load sessions" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const session = parseSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { sessionId } = await params;

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = await import("postgres");
    const schema = await import("@/db/schema");
    const { eq, and, asc } = await import("drizzle-orm");

    const client = postgres.default(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    try {
      const prompts = await db.query.prompts.findMany({
        where: and(
          eq(schema.prompts.userId, session.userId),
          eq(schema.prompts.sessionId, sessionId)
        ),
        orderBy: [asc(schema.prompts.timestamp)],
        with: {
          promptTags: {
            with: {
              tag: true,
            },
          },
        },
      });

      if (prompts.length === 0) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }

      const first = prompts[0];
      const last = prompts[prompts.length - 1];

      return NextResponse.json({
        sessionId,
        projectName: first.projectName,
        source: first.source,
        deviceName: first.deviceName,
        workingDirectory: first.workingDirectory,
        startedAt: first.timestamp,
        endedAt: last.timestamp,
        prompts: prompts.map((p) => ({
          id: p.id,
          timestamp: p.timestamp,
          promptText: p.promptText,
          responseText: p.responseText,
          promptLength: p.promptLength,
          responseLength: p.responseLength,
          tokenEstimate: p.tokenEstimate,
          tokenEstimateResponse: p.tokenEstimateResponse,
          promptType: p.promptType,
          tags: p.promptTags.map((pt) => pt.tag),
        })),
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Session detail API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

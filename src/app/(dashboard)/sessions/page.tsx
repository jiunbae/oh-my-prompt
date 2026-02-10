import { SessionCard } from "@/components/session-card";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface SearchParams {
  page?: string;
  project?: string;
  from?: string;
  to?: string;
}

async function getCurrentUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return parseSessionToken(sessionToken);
}

interface SessionRow {
  session_id: string;
  started_at: string;
  ended_at: string;
  prompt_count: number;
  response_count: number;
  project_name: string | null;
  source: string | null;
  device_name: string | null;
  first_prompt: string;
  total_tokens: number;
}

async function getSessions(params: SearchParams, userId: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { sessions: [], totalCount: 0 };

  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgresModule = await import("postgres");
  const schema = await import("@/db/schema");
  const { eq, and, gte, lte, sql } = await import("drizzle-orm");

  const client = postgresModule.default(connectionString);
  const db = drizzle(client, { schema });

  const page = parseInt(params.page ?? "1", 10);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(schema.prompts.userId, userId),
    sql`${schema.prompts.sessionId} IS NOT NULL`,
  ];

  if (params.project) conditions.push(eq(schema.prompts.projectName, params.project));
  if (params.from) conditions.push(gte(schema.prompts.timestamp, new Date(params.from)));
  if (params.to) {
    const toDate = new Date(params.to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.prompts.timestamp, toDate));
  }

  const whereClause = and(...conditions);

  try {
    const [sessionsResult, countResult] = await Promise.all([
      db.execute(sql`
        SELECT
          ${schema.prompts.sessionId} as session_id,
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
        WHERE ${whereClause}
        GROUP BY ${schema.prompts.sessionId}
        ORDER BY MAX(${schema.prompts.timestamp}) DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT ${schema.prompts.sessionId})::int as count
        FROM ${schema.prompts}
        WHERE ${whereClause}
      `),
    ]);

    await client.end();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sRows = (sessionsResult as any).rows ?? sessionsResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cRows = (countResult as any).rows ?? countResult;
    return {
      sessions: sRows as SessionRow[],
      totalCount: Number((cRows[0] as Record<string, unknown>)?.count ?? 0),
    };
  } catch (error) {
    console.error("Sessions query error:", error);
    await client.end();
    return { sessions: [], totalCount: 0 };
  }
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;

  const { sessions, totalCount } = await getSessions(params, user.userId);
  const currentPage = parseInt(params.page ?? "1", 10);
  const pageSize = 20;
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Sessions</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Browse your Claude Code sessions ({totalCount} total)
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>No sessions found.</p>
          <p className="text-sm mt-1">Sessions are created when prompts share a session ID.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              sessionId={s.session_id}
              firstPrompt={s.first_prompt}
              startedAt={String(s.started_at)}
              endedAt={String(s.ended_at)}
              promptCount={s.prompt_count}
              responseCount={s.response_count}
              projectName={s.project_name}
              source={s.source}
              deviceName={s.device_name}
              totalTokens={s.total_tokens}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {currentPage > 1 && (
            <Link
              href={`/sessions?page=${currentPage - 1}${params.project ? `&project=${params.project}` : ""}${params.from ? `&from=${params.from}` : ""}${params.to ? `&to=${params.to}` : ""}`}
              className="px-3 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-zinc-400">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages && (
            <Link
              href={`/sessions?page=${currentPage + 1}${params.project ? `&project=${params.project}` : ""}${params.from ? `&from=${params.from}` : ""}${params.to ? `&to=${params.to}` : ""}`}
              className="px-3 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

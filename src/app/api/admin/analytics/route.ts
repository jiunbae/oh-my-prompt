import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";

export async function GET(request: NextRequest) {
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

    if (!session.isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Parse optional userId filter
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || null;

    // Fetch analytics (null = all users)
    const analytics = await getAnalytics(userId);

    // Fetch user list and per-user summary
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = await import("postgres");
    const schema = await import("@/db/schema");
    const { desc, eq, sql } = await import("drizzle-orm");

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
    }

    const client = postgres.default(connectionString);
    const db = drizzle(client, { schema });

    try {
      const [userList, userSummaryRows] = await Promise.all([
        // User list for filter dropdown
        db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
          })
          .from(schema.users)
          .orderBy(schema.users.email),

        // Per-user summary
        db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
            totalPrompts: sql<number>`count(*)`,
            totalTokens: sql<number>`coalesce(sum(${schema.prompts.tokenEstimate}), 0)`,
            uniqueProjects: sql<number>`count(distinct ${schema.prompts.projectName})`,
            lastActivity: sql<string>`max(${schema.prompts.timestamp})`,
            prompts30d: sql<number>`count(*) filter (where ${schema.prompts.timestamp} >= now() - interval '30 days')`,
          })
          .from(schema.prompts)
          .innerJoin(schema.users, eq(schema.prompts.userId, schema.users.id))
          .groupBy(schema.users.id, schema.users.name, schema.users.email)
          .orderBy(desc(sql`count(*)`)),
      ]);

      return NextResponse.json({
        analytics,
        users: userList,
        userSummary: userSummaryRows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          totalPrompts: Number(row.totalPrompts),
          totalTokens: Number(row.totalTokens),
          uniqueProjects: Number(row.uniqueProjects),
          lastActivity: row.lastActivity,
          prompts30d: Number(row.prompts30d),
        })),
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error("Admin analytics API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

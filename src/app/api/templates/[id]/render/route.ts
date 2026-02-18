import { NextRequest, NextResponse } from "next/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { z } from "zod";

function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL not configured");
  const client = postgres(connectionString);
  return { db: drizzle(client, { schema }), client };
}

async function getSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return parseSessionToken(sessionToken);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const renderBodySchema = z.object({
  values: z.record(z.string(), z.string()).optional().default({}),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { db, client } = getDb();
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = renderBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { values } = parsed.data;

    const [tmpl] = await db
      .select()
      .from(schema.promptTemplates)
      .where(
        and(
          eq(schema.promptTemplates.id, id),
          or(
            eq(schema.promptTemplates.userId, session.userId),
            eq(schema.promptTemplates.isPublic, true)
          )
        )
      )
      .limit(1);

    if (!tmpl) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Render template by replacing {{variable}} with values
    let rendered = tmpl.template;
    const vars = (tmpl.variables as Array<{ name: string; default?: string }>) || [];

    for (const v of vars) {
      const value = values?.[v.name] ?? v.default ?? "";
      const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(v.name)}\\s*\\}\\}`, "g");
      rendered = rendered.replace(regex, () => value);
    }

    // Also replace any remaining {{placeholders}} that weren't in the variables list
    if (values) {
      for (const [key, val] of Object.entries(values)) {
        const regex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
        rendered = rendered.replace(regex, () => String(val));
      }
    }

    // Increment usage count
    await db
      .update(schema.promptTemplates)
      .set({ usageCount: sql`${schema.promptTemplates.usageCount} + 1` })
      .where(eq(schema.promptTemplates.id, id));

    return NextResponse.json({ rendered });
  } catch (error) {
    console.error("Templates render error:", error);
    return NextResponse.json({ error: "Failed to render template" }, { status: 500 });
  } finally {
    await client.end();
  }
}

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export async function findUserByToken(token: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.token, token))
    .limit(1);

  return user ?? null;
}

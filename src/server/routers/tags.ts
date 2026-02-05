import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const client = postgres(connectionString);
    db = drizzle(client, { schema });
  }
  return db;
}

export const tagsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    return await db
      .select()
      .from(schema.tags)
      .orderBy(schema.tags.name);
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [tag] = await db
        .insert(schema.tags)
        .values({
          name: input.name,
          color: input.color,
        })
        .onConflictDoUpdate({
          target: schema.tags.name,
          set: { color: input.color },
        })
        .returning();
      return tag;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(schema.tags).where(eq(schema.tags.id, input.id));
      return { success: true };
    }),

  assignToPrompt: protectedProcedure
    .input(z.object({ promptId: z.string().uuid(), tagId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      
      const [prompt] = await db
        .select()
        .from(schema.prompts)
        .where(and(eq(schema.prompts.id, input.promptId), eq(schema.prompts.userId, ctx.user.id)))
        .limit(1);

      if (!prompt) {
        throw new Error("Prompt not found or access denied");
      }

      await db
        .insert(schema.promptTags)
        .values({
          promptId: input.promptId,
          tagId: input.tagId,
        })
        .onConflictDoNothing();

      return { success: true };
    }),

  removeFromPrompt: protectedProcedure
    .input(z.object({ promptId: z.string().uuid(), tagId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      
      const [prompt] = await db
        .select()
        .from(schema.prompts)
        .where(and(eq(schema.prompts.id, input.promptId), eq(schema.prompts.userId, ctx.user.id)))
        .limit(1);

      if (!prompt) {
        throw new Error("Prompt not found or access denied");
      }

      await db
        .delete(schema.promptTags)
        .where(
          and(
            eq(schema.promptTags.promptId, input.promptId),
            eq(schema.promptTags.tagId, input.tagId)
          )
        );

      return { success: true };
    }),
});

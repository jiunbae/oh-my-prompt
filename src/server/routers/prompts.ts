import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { desc, eq, sql, and, gte, lte, isNull } from "drizzle-orm";

/**
 * Verify user is a member of the given team. Returns the role or null.
 */
async function verifyTeamMembership(userId: string, teamId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .limit(1);
  return row?.role ?? null;
}

export const promptsRouter = createTRPCRouter({
  /**
   * List prompts with pagination and filtering
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().default(0),
        projectName: z.string().optional(),
        promptType: z.enum(["user_input", "task_notification", "system"]).optional(),
        search: z.string().optional(),
        qualityScoreMin: z.number().min(0).max(100).optional(),
        qualityScoreMax: z.number().min(0).max(100).optional(),
        topicTags: z.array(z.string()).optional(),
        teamId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input, ctx }) => {

      const { limit, offset, projectName, promptType, search, qualityScoreMin, qualityScoreMax, topicTags, teamId } = input;

      let conditions: (ReturnType<typeof eq> | ReturnType<typeof isNull> | ReturnType<typeof sql> | ReturnType<typeof gte> | ReturnType<typeof lte>)[];

      if (teamId) {
        const role = await verifyTeamMembership(ctx.user.id, teamId);
        if (!role) {
          return { items: [], totalCount: 0 };
        }
        conditions = [eq(schema.prompts.teamId, teamId), isNull(schema.prompts.deletedAt)];
      } else {
        conditions = [eq(schema.prompts.userId, ctx.user.id), isNull(schema.prompts.deletedAt)];
      }
      if (projectName) {
        conditions.push(eq(schema.prompts.projectName, projectName));
      }
      if (promptType) {
        conditions.push(eq(schema.prompts.promptType, promptType));
      }
      if (search) {
        conditions.push(sql`${schema.prompts.searchVector} @@ websearch_to_tsquery('english', ${search})`);
      }
      if (qualityScoreMin !== undefined) {
        conditions.push(gte(schema.prompts.qualityScore, qualityScoreMin));
      }
      if (qualityScoreMax !== undefined) {
        conditions.push(lte(schema.prompts.qualityScore, qualityScoreMax));
      }
      if (topicTags && topicTags.length > 0) {
        conditions.push(sql`${schema.prompts.topicTags} && ${topicTags}::text[]`);
      }

      const whereClause = and(...conditions);

      const [items, countResult] = await Promise.all([
        db.query.prompts.findMany({
          where: whereClause,
          orderBy: [desc(schema.prompts.timestamp)],
          limit,
          offset,
          with: {
            promptTags: {
              with: {
                tag: true,
              },
            },
          },
        }),
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.prompts)
          .where(whereClause),
      ]);

      return {
        items: items.map((item) => ({
          ...item,
          tags: item.promptTags.map((pt) => pt.tag),
          preview: item.promptText.slice(0, 200) + (item.promptText.length > 200 ? "..." : ""),
        })),
        totalCount: Number(countResult[0]?.count ?? 0),
      };
    }),

  /**
   * Get a single prompt by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const result = await db.query.prompts.findFirst({
        where: and(eq(schema.prompts.id, input.id), isNull(schema.prompts.deletedAt)),
        with: {
          promptTags: {
            with: {
              tag: true,
            },
          },
        },
      });

      if (!result) return null;

      // Check ownership or team membership
      const isOwner = result.userId === ctx.user.id;
      let hasTeamAccess = false;
      if (result.teamId) {
        const role = await verifyTeamMembership(ctx.user.id, result.teamId);
        hasTeamAccess = !!role;
      }

      if (!isOwner && !hasTeamAccess) {
        return null;
      }

      return {
        ...result,
        tags: result.promptTags.map((pt) => pt.tag),
      };
    }),

  /**
   * Get prompt statistics/analytics
   */
  getStats: protectedProcedure
    .input(z.object({ teamId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const teamId = input?.teamId;
      let accessCondition;
      if (teamId) {
        const role = await verifyTeamMembership(ctx.user.id, teamId);
        if (!role) {
          return {
            totalPrompts: 0,
            totalTokens: 0,
            uniqueProjects: 0,
            promptsByType: {},
            promptsByProject: [],
          };
        }
        accessCondition = eq(schema.prompts.teamId, teamId);
      } else {
        accessCondition = eq(schema.prompts.userId, ctx.user.id);
      }

      const [totalResult, projectsResult, typesResult] = await Promise.all([
        db
          .select({
            totalPrompts: sql<number>`count(*)`,
            totalTokens: sql<number>`coalesce(sum(token_estimate), 0)`,
            uniqueProjects: sql<number>`count(distinct project_name)`,
          })
          .from(schema.prompts)
          .where(and(accessCondition, isNull(schema.prompts.deletedAt))),
        db
          .select({
            project: schema.prompts.projectName,
            count: sql<number>`count(*)`,
          })
          .from(schema.prompts)
          .where(and(sql`project_name is not null`, accessCondition, isNull(schema.prompts.deletedAt)))
          .groupBy(schema.prompts.projectName)
          .orderBy(desc(sql`count(*)`))
          .limit(10),
        db
          .select({
            type: schema.prompts.promptType,
            count: sql<number>`count(*)`,
          })
          .from(schema.prompts)
          .where(and(accessCondition, isNull(schema.prompts.deletedAt)))
          .groupBy(schema.prompts.promptType),
      ]);

    const promptsByType: Record<string, number> = {};
    typesResult.forEach((t) => {
      if (t.type) promptsByType[t.type] = Number(t.count);
    });

    return {
      totalPrompts: Number(totalResult[0]?.totalPrompts ?? 0),
      totalTokens: Number(totalResult[0]?.totalTokens ?? 0),
      uniqueProjects: Number(totalResult[0]?.uniqueProjects ?? 0),
      promptsByType,
      promptsByProject: projectsResult.map((p) => ({
        project: p.project ?? "unknown",
        count: Number(p.count),
      })),
    };
  }),

  /**
   * Get unique project names
   */
  getProjects: protectedProcedure
    .input(z.object({ teamId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const teamId = input?.teamId;
      let accessCondition;
      if (teamId) {
        const role = await verifyTeamMembership(ctx.user.id, teamId);
        if (!role) return [];
        accessCondition = eq(schema.prompts.teamId, teamId);
      } else {
        accessCondition = eq(schema.prompts.userId, ctx.user.id);
      }

      const result = await db
        .select({
          projectName: schema.prompts.projectName,
          promptCount: sql<number>`count(*)`,
          lastPrompt: sql<Date>`max(timestamp)`,
        })
        .from(schema.prompts)
        .where(and(sql`project_name is not null`, accessCondition, isNull(schema.prompts.deletedAt)))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`));

      return result.map((r) => ({
        projectName: r.projectName ?? "unknown",
        promptCount: Number(r.promptCount),
        lastPrompt: r.lastPrompt,
      }));
    }),
});

export type PromptsRouter = typeof promptsRouter;

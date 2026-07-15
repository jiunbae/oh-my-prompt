import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { desc, eq, sql, and, gte, lte, isNull } from "drizzle-orm";
import {
  canManagePromptAccess,
  canViewPrompt,
  teamPromptViewConditionForMember,
} from "@/lib/team-access";
import { toPromptDto } from "@/lib/prompt-dto";

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
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
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
        conditions = [
          eq(schema.prompts.teamId, teamId),
          teamPromptViewConditionForMember(ctx.user.id),
          isNull(schema.prompts.deletedAt),
        ];
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
          ...toPromptDto(item),
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

      if (!(await canViewPrompt(ctx.user.id, result.id))) {
        return null;
      }

      return {
        ...toPromptDto(result),
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
        accessCondition = and(
          eq(schema.prompts.teamId, teamId),
          teamPromptViewConditionForMember(ctx.user.id)
        );
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
        accessCondition = and(
          eq(schema.prompts.teamId, teamId),
          teamPromptViewConditionForMember(ctx.user.id)
        );
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

  /**
   * Create a shareable link for a prompt
   */
  createShare: protectedProcedure
    .input(
      z.object({
        promptId: z.string().uuid(),
        access: z.enum(["read", "clone"]).default("read"),
        expiresInHours: z.number().int().positive().max(8760).optional().default(168),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { promptId, access, expiresInHours } = input;

      const [prompt] = await db
        .select({ id: schema.prompts.id })
        .from(schema.prompts)
        .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
        .limit(1);

      if (!prompt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Prompt not found" });
      }

      if (!(await canManagePromptAccess(ctx.user.id, promptId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const bytes = crypto.randomBytes(16);
      let token = "";
      for (let i = 0; i < 16; i++) {
        token += chars[bytes[i] % chars.length];
      }

      const expiresAt = expiresInHours
        ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
        : null;

      const [share] = await db
        .insert(schema.promptShares)
        .values({
          promptId,
          token,
          access,
          expiresAt,
        })
        .returning();

      return {
        shareUrl: `/share/${token}`,
        token: share.token,
        expiresAt: share.expiresAt,
        access: share.access,
      };
    }),

  /**
   * List active shares for a prompt
   */
  listShares: protectedProcedure
    .input(z.object({ promptId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const { promptId } = input;

      const [prompt] = await db
        .select({ id: schema.prompts.id })
        .from(schema.prompts)
        .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
        .limit(1);

      if (!prompt) return { shares: [] };

      if (!(await canManagePromptAccess(ctx.user.id, promptId))) return { shares: [] };

      const shares = await db
        .select({
          id: schema.promptShares.id,
          token: schema.promptShares.token,
          access: schema.promptShares.access,
          expiresAt: schema.promptShares.expiresAt,
          viewCount: schema.promptShares.viewCount,
          createdAt: schema.promptShares.createdAt,
        })
        .from(schema.promptShares)
        .where(eq(schema.promptShares.promptId, promptId))
        .orderBy(schema.promptShares.createdAt);

      const now = new Date();
      const activeShares = shares.filter((s) => !s.expiresAt || new Date(s.expiresAt) >= now);

      return { shares: activeShares };
    }),

  /**
   * Revoke a share
   */
  revokeShare: protectedProcedure
    .input(z.object({ promptId: z.string().uuid(), shareId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { promptId, shareId } = input;

      const [prompt] = await db
        .select({ id: schema.prompts.id })
        .from(schema.prompts)
        .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
        .limit(1);

      if (!prompt) throw new TRPCError({ code: "NOT_FOUND", message: "Prompt not found" });

      if (!(await canManagePromptAccess(ctx.user.id, promptId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      const [share] = await db
        .select({ id: schema.promptShares.id })
        .from(schema.promptShares)
        .where(and(eq(schema.promptShares.id, shareId), eq(schema.promptShares.promptId, promptId)))
        .limit(1);

      if (!share) throw new TRPCError({ code: "NOT_FOUND", message: "Share not found" });

      await db.delete(schema.promptShares).where(eq(schema.promptShares.id, shareId));

      return { success: true };
    }),
});

export type PromptsRouter = typeof promptsRouter;

import { createTRPCRouter } from "../trpc";
import { promptsRouter } from "./prompts";
import { tagsRouter } from "./tags";
import { analyticsRouter } from "./analytics";
import { insightsRouter } from "./insights";

/**
 * Root router - all routers are merged here
 */
export const appRouter = createTRPCRouter({
  prompts: promptsRouter,
  tags: tagsRouter,
  analytics: analyticsRouter,
  insights: insightsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;

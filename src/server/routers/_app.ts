import { createTRPCRouter } from "../trpc";
import { promptsRouter } from "./prompts";
import { tagsRouter } from "./tags";

/**
 * Root router - all routers are merged here
 */
export const appRouter = createTRPCRouter({
  prompts: promptsRouter,
  tags: tagsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;

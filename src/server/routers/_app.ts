import { createTRPCRouter } from "../trpc";
import { promptsRouter } from "./prompts";

/**
 * Root router - all routers are merged here
 */
export const appRouter = createTRPCRouter({
  prompts: promptsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;

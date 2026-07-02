import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Cache the postgres.js pool + drizzle instance on globalThis so Next.js dev
// HMR (which re-evaluates modules on every edit) reuses one connection pool
// instead of leaking a new pool of up to `max` connections per reload.
const globalForDb = globalThis as unknown as {
  __ompDbClient?: ReturnType<typeof postgres>;
  __ompDb?: PostgresJsDatabase<typeof schema>;
};

function getInstance(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb.__ompDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    const client =
      globalForDb.__ompDbClient ??
      postgres(connectionString, {
        max: 20,
        idle_timeout: 30,
        connect_timeout: 10,
      });
    globalForDb.__ompDbClient = client;
    globalForDb.__ompDb = drizzle(client, { schema });
  }
  return globalForDb.__ompDb;
}

/**
 * Shared database client singleton with connection pooling (max 20).
 * Lazy-initialized on first property access to avoid build-time failures
 * when DATABASE_URL is not set (e.g., during `next build`).
 */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const instance = getInstance();
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  },
);

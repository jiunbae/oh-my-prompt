import Redis from "ioredis";
import { env } from "@/env";
import { logger } from "./logger";

const redisOptions = {
  maxRetriesPerRequest: null,
  // Don't open a TCP connection at import time — connect lazily on first
  // command. This keeps module evaluation (and Next.js dev HMR re-evaluation)
  // from eagerly opening sockets.
  lazyConnect: true,
};

// Cache the client on globalThis so dev HMR reuses a single connection instead
// of leaking a new Redis socket on every module reload.
const globalForRedis = globalThis as unknown as {
  __ompRedis?: Redis;
};

export const redis: Redis =
  globalForRedis.__ompRedis ?? new Redis(env.REDIS_URL, redisOptions);

if (!globalForRedis.__ompRedis) {
  redis.on("error", (err) => {
    logger.error({ err }, "Redis connection error");
  });

  redis.on("connect", () => {
    logger.info("Connected to Redis");
  });

  globalForRedis.__ompRedis = redis;
}

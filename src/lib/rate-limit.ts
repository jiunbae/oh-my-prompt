/**
 * Redis-backed sliding-window rate limiter using sorted sets.
 * Falls back to in-memory implementation if Redis is unavailable.
 *
 * Uses a Lua script (ZADD + ZREMRANGEBYSCORE + ZCARD + PEXPIRE) executed
 * atomically in Redis. Because ioredis is async but the exported API is sync,
 * we cache the last known count per key and fire the Lua script eagerly.
 * Each call returns the result from the *previous* pipeline (eventual consistency),
 * which is an acceptable trade-off for rate limiting.
 */

import { redis } from "@/lib/redis";
import { logger } from "./logger";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const REDIS_KEY_PREFIX = "rl:";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

// ---------------------------------------------------------------------------
// Redis Lua script — runs atomically per key
// KEYS[1] = the sorted-set key
// ARGV[1] = current timestamp (ms)
// ARGV[2] = window start (ms)
// ARGV[3] = unique member suffix (avoids collisions within the same ms)
// ARGV[4] = TTL in ms
// Returns: current count in the window
// ---------------------------------------------------------------------------
const SLIDING_WINDOW_LUA = `
local key       = KEYS[1]
local now       = tonumber(ARGV[1])
local window    = tonumber(ARGV[2])
local member    = ARGV[3]
local ttl       = tonumber(ARGV[4])

redis.call('ZADD', key, now, member)
redis.call('ZREMRANGEBYSCORE', key, 0, window)
local count = redis.call('ZCARD', key)
redis.call('PEXPIRE', key, ttl)
return count
`;

// Pre-register the Lua script so ioredis can reuse EVALSHA across calls.
redis.defineCommand("slidingWindowRateLimit", {
  numberOfKeys: 1,
  lua: SLIDING_WINDOW_LUA,
});

/** Last-known count per Redis key, populated from resolved pipeline results. */
const lastKnownCount = new Map<string, number>();

/** Timestamp of the last cache-prune pass. */
let cacheCleanupTime = Date.now();

function pruneCountCache() {
  const now = Date.now();
  if (now - cacheCleanupTime < CLEANUP_INTERVAL_MS) return;
  cacheCleanupTime = now;
  lastKnownCount.clear();
}

function isRedisReady(): boolean {
  try {
    return redis.status === "ready";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Redis-backed limiter
// ---------------------------------------------------------------------------
function createRedisRateLimiter(
  maxRequests: number,
  windowMs: number,
): (key: string) => RateLimitResult {
  const prefix = `${REDIS_KEY_PREFIX}${maxRequests}:${windowMs}:`;

  return (key: string): RateLimitResult => {
    const redisKey = `${prefix}${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}:${Math.random()}`;

    // Fire the Lua script asynchronously. The result updates the cache for
    // the *next* invocation of this key, giving us eventual consistency.
    (redis as any)
      .slidingWindowRateLimit(redisKey, now, windowStart, member, windowMs)
      .then((count: number) => {
        lastKnownCount.set(redisKey, count);
      })
      .catch(() => {
        // Swallow — isRedisReady() will switch us to the fallback limiter.
      });

    // Return based on the last-known count (0 on first call — optimistic allow).
    const count = lastKnownCount.get(redisKey) ?? 0;

    if (count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: windowMs,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - count - 1),
      retryAfterMs: 0,
    };
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback limiter (identical behaviour to the original implementation)
// ---------------------------------------------------------------------------
function createMemoryRateLimiter(
  maxRequests: number,
  windowMs: number,
): (key: string) => RateLimitResult {
  const store = new Map<string, number[]>();
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;

    const cutoff = now - windowMs;
    for (const [key, entry] of store) {
      const filtered = entry.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        store.delete(key);
      } else {
        store.set(key, filtered);
      }
    }
  }

  return (key: string): RateLimitResult => {
    const now = Date.now();
    cleanup();

    let timestamps = store.get(key);
    if (!timestamps) {
      timestamps = [];
      store.set(key, timestamps);
    }

    const cutoff = now - windowMs;
    const filtered = timestamps.filter((t) => t > cutoff);
    timestamps.length = 0;
    for (const t of filtered) timestamps.push(t);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + windowMs - now,
      };
    }

    timestamps.push(now);
    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      retryAfterMs: 0,
    };
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a rate limiter backed by Redis (sorted-set sliding window).
 * Automatically falls back to an in-memory limiter if Redis is unavailable.
 *
 * Each limiter has independent tracking so auth limits don't affect search limits.
 */
export function createRateLimiter(
  maxRequests: number,
  windowMs: number,
): (key: string) => RateLimitResult {
  const memoryLimiter = createMemoryRateLimiter(maxRequests, windowMs);
  const redisLimiter = createRedisRateLimiter(maxRequests, windowMs);

  return (key: string): RateLimitResult => {
    if (isRedisReady()) {
      pruneCountCache();
      return redisLimiter(key);
    }
    logger.warn(
      { maxRequests, windowMs },
      "Redis unavailable, falling back to in-memory rate limiter",
    );
    return memoryLimiter(key);
  };
}

/** Rate limiter presets — each has its own isolated store and cleanup timer */
export const rateLimiters = {
  /** Auth endpoints: 10 requests per minute */
  auth: createRateLimiter(10, 60 * 1000),
  /** Search endpoints: 30 requests per minute */
  search: createRateLimiter(30, 60 * 1000),
  /** Webhook test: 5 requests per minute */
  webhookTest: createRateLimiter(5, 60 * 1000),
  /** General API: 100 requests per minute */
  api: createRateLimiter(100, 60 * 1000),
  /** LLM-backed endpoints: 10 requests per minute (expensive) */
  llm: createRateLimiter(10, 60 * 1000),
};
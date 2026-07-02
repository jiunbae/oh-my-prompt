/**
 * Redis-backed sliding-window rate limiter using sorted sets.
 * Falls back to in-memory implementation if Redis is unavailable.
 *
 * Uses a Lua script (ZADD + ZREMRANGEBYSCORE + ZCARD + PEXPIRE) executed
 * atomically in Redis. The limiter is async and awaits the Lua result so that
 * concurrent requests observe an authoritative, up-to-date count (this closes a
 * burst-bypass hole where a stale cached count let concurrent requests all pass).
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

/** A rate limiter resolves asynchronously with the authoritative decision. */
export type RateLimiter = (key: string) => Promise<RateLimitResult>;

// ---------------------------------------------------------------------------
// Redis Lua script — runs atomically per key
// KEYS[1] = the sorted-set key
// ARGV[1] = current timestamp (ms)
// ARGV[2] = window start (ms)
// ARGV[3] = unique member suffix (avoids collisions within the same ms)
// ARGV[4] = TTL in ms
// Returns: current count in the window (including the just-added member)
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

// Typed view of the custom command ioredis attaches at runtime via defineCommand.
type RedisWithRateLimit = typeof redis & {
  slidingWindowRateLimit(
    key: string,
    now: number,
    windowStart: number,
    member: string,
    ttl: number,
  ): Promise<number>;
};

function isRedisReady(): boolean {
  try {
    return redis.status === "ready";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Client IP extraction (spoofing-resistant)
// ---------------------------------------------------------------------------

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const UNKNOWN_IP = "unknown";

type HeaderCarrier = { headers: { get(name: string): string | null } };

/**
 * Resolve the real client IP from proxy headers in a spoofing-resistant way.
 *
 * `X-Forwarded-For` is a comma-separated list where each proxy *appends* the
 * address it received the connection from. The left-most entries are fully
 * client-controlled and must NOT be trusted. Given a known number of trusted
 * reverse-proxy hops in front of the app, the real client is the entry that is
 * `trustedHops` positions from the right.
 *
 * @param request       Anything exposing `.headers.get()` (NextRequest / Request).
 * @param trustedHops   Number of trusted proxies between the app and the client.
 *                      Defaults to `TRUSTED_PROXY_HOPS` env or 1.
 */
export function getClientIp(
  request: HeaderCarrier,
  trustedHops?: number,
): string {
  const envHops = Number(process.env.TRUSTED_PROXY_HOPS);
  const resolvedHops =
    trustedHops ??
    (Number.isFinite(envHops) && envHops > 0 ? envHops : DEFAULT_TRUSTED_PROXY_HOPS);
  const hops = Math.max(1, resolvedHops);

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      // Take the entry `hops` positions from the right (clamped to the list).
      const idx = Math.max(0, parts.length - hops);
      const ip = parts[idx];
      if (ip) return ip;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return UNKNOWN_IP;
}

// ---------------------------------------------------------------------------
// Redis-backed limiter
// ---------------------------------------------------------------------------
function createRedisRateLimiter(
  maxRequests: number,
  windowMs: number,
): RateLimiter {
  const prefix = `${REDIS_KEY_PREFIX}${maxRequests}:${windowMs}:`;

  return async (key: string): Promise<RateLimitResult> => {
    const redisKey = `${prefix}${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}:${Math.random()}`;

    // Await the authoritative count from Redis. `count` includes the member we
    // just added, so it equals the number of requests in the current window.
    const count: number = await (redis as RedisWithRateLimit).slidingWindowRateLimit(
      redisKey,
      now,
      windowStart,
      member,
      windowMs,
    );

    if (count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: windowMs,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - count),
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
): RateLimiter {
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

  return async (key: string): Promise<RateLimitResult> => {
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
 * The returned limiter is async: callers MUST await it so the decision reflects
 * the authoritative count (preventing concurrent-burst bypass).
 *
 * Each limiter has independent tracking so auth limits don't affect search limits.
 */
export function createRateLimiter(
  maxRequests: number,
  windowMs: number,
): RateLimiter {
  const memoryLimiter = createMemoryRateLimiter(maxRequests, windowMs);
  const redisLimiter = createRedisRateLimiter(maxRequests, windowMs);

  return async (key: string): Promise<RateLimitResult> => {
    if (isRedisReady()) {
      try {
        return await redisLimiter(key);
      } catch (err) {
        logger.warn(
          { err, maxRequests, windowMs },
          "Redis rate limiter failed, falling back to in-memory limiter",
        );
        return memoryLimiter(key);
      }
    }
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
  /** Team activity SSE: 5 concurrent connections per user */
  teamActivity: createRateLimiter(5, 60 * 1000),
};

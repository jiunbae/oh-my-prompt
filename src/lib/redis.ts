import Redis from "ioredis";
import { env } from "@/env";
import { logger } from "./logger";

const redisOptions = {
  maxRetriesPerRequest: null,
};

export const redis = new Redis(env.REDIS_URL, redisOptions);

redis.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});

redis.on("connect", () => {
  logger.info("Connected to Redis");
});

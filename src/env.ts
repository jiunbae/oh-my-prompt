import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const isTest =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const testDefaults = isTest
  ? {
      DATABASE_URL: "postgres://localhost:5432/omp_test",
      MINIO_ENDPOINT: "localhost",
      MINIO_ACCESS_KEY: "test",
      MINIO_SECRET_KEY: "test",
      MINIO_BUCKET: "omp-test",
      MINIO_USE_SSL: "false",
    }
  : {};

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    MINIO_ENDPOINT: z.string().min(1).optional(),
    MINIO_ACCESS_KEY: z.string().min(1).optional(),
    MINIO_SECRET_KEY: z.string().min(1).optional(),
    MINIO_BUCKET: z.string().min(1).optional(),
    MINIO_USE_SSL: z
      .string()
      .optional()
      .default("true")
      .transform((val) => val === "true"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  client: {
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL ?? testDefaults.DATABASE_URL,
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT ?? testDefaults.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY:
      process.env.MINIO_ACCESS_KEY ?? testDefaults.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY:
      process.env.MINIO_SECRET_KEY ?? testDefaults.MINIO_SECRET_KEY,
    MINIO_BUCKET: process.env.MINIO_BUCKET ?? testDefaults.MINIO_BUCKET,
    MINIO_USE_SSL: process.env.MINIO_USE_SSL ?? testDefaults.MINIO_USE_SSL,
    REDIS_URL: process.env.REDIS_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: isTest || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

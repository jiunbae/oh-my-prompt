import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const isTest =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const testDefaults: Record<string, string> = isTest
  ? {
      DATABASE_URL: "postgres://localhost:5432/omp_test",
      SESSION_SECRET: "test-session-secret-for-testing-only",
    }
  : {};

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Upload redaction
    OMP_UPLOAD_REDACT_ENABLED: z.string().default("true"),
    OMP_UPLOAD_REDACT_MASK: z.string().default("[REDACTED]"),
    // Upload limits
    OMP_MAX_BODY_SIZE_MB: z.coerce.number().default(10),
    OMP_MAX_RECORDS_PER_REQUEST: z.coerce.number().default(1000),
    // Webhook limits
    OMP_WEBHOOK_TIMEOUT_MS: z.coerce.number().default(10_000),
    OMP_WEBHOOK_MAX_FAIL_COUNT: z.coerce.number().default(10),
  },
  client: {
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL ?? testDefaults.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    SESSION_SECRET: process.env.SESSION_SECRET ?? testDefaults.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    OMP_UPLOAD_REDACT_ENABLED: process.env.OMP_UPLOAD_REDACT_ENABLED,
    OMP_UPLOAD_REDACT_MASK: process.env.OMP_UPLOAD_REDACT_MASK,
    OMP_MAX_BODY_SIZE_MB: process.env.OMP_MAX_BODY_SIZE_MB,
    OMP_MAX_RECORDS_PER_REQUEST: process.env.OMP_MAX_RECORDS_PER_REQUEST,
    OMP_WEBHOOK_TIMEOUT_MS: process.env.OMP_WEBHOOK_TIMEOUT_MS,
    OMP_WEBHOOK_MAX_FAIL_COUNT: process.env.OMP_WEBHOOK_MAX_FAIL_COUNT,
  },
  skipValidation: isTest || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

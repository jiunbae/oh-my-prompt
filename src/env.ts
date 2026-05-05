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
    // Slack integration
    SLACK_WEBHOOK_TIMEOUT_MS: z.coerce.number().default(5_000),
    OMP_WEBHOOK_MAX_FAIL_COUNT: z.coerce.number().default(10),
    // Email provider
    EMAIL_PROVIDER: z.enum(["smtp", "resend", "sendgrid", ""]).default(""),
    EMAIL_FROM: z.string().default("Oh My Prompt <noreply@example.com>"),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().default(""),
    SMTP_PASS: z.string().default(""),
    SMTP_SECURE: z.coerce.boolean().default(false),
    RESEND_API_KEY: z.string().default(""),
    SENDGRID_API_KEY: z.string().default(""),
    // Embedding provider (optional; e.g. Ollama or OpenAI-compatible)
    EMBEDDING_API_URL: z.string().url().optional(),
    EMBEDDING_API_KEY: z.string().default(""),
    EMBEDDING_MODEL: z.string().default("all-minilm"),
    // Suggestion provider (optional; falls back to embedding provider)
    SUGGESTION_PROVIDER: z.string().url().optional(),
    SUGGESTION_MODEL: z.string().default(""),
    SUGGESTION_MAX_TOKENS: z.coerce.number().default(500),
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
    SLACK_WEBHOOK_TIMEOUT_MS: process.env.SLACK_WEBHOOK_TIMEOUT_MS,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_SECURE: process.env.SMTP_SECURE,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    EMBEDDING_API_URL: process.env.EMBEDDING_API_URL,
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    SUGGESTION_PROVIDER: process.env.SUGGESTION_PROVIDER,
    SUGGESTION_MODEL: process.env.SUGGESTION_MODEL,
    SUGGESTION_MAX_TOKENS: process.env.SUGGESTION_MAX_TOKENS,
  },
  skipValidation: isTest || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

-- Outbox for jiun-api LLM usage reports.
-- Metadata only: token counts, latency, model and vendor. No prompt text,
-- no completion text, no credentials. `api_key_label` is a contract label
-- (free-1..free-6, paid-1), never a key and never a Vault field name.
CREATE TABLE IF NOT EXISTS "llm_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" varchar(255) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "provider" varchar(32) NOT NULL,
  "model" varchar(255) NOT NULL,
  "api_key_label" varchar(32),
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "cached_input_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "latency_ms" integer,
  "status" varchar(16) NOT NULL DEFAULT 'success',
  "delivery_status" varchar(16) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "delivered_at" timestamp with time zone
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_usage_events_event_id_unique" ON "llm_usage_events"("event_id");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_usage_events_pending" ON "llm_usage_events"("delivery_status", "next_attempt_at");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_llm_usage_events_delivered" ON "llm_usage_events"("delivered_at");

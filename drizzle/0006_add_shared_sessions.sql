-- Shared sessions table for read-only session sharing
CREATE TABLE IF NOT EXISTS "shared_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" varchar(255) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "share_token" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone,
  "view_count" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_shared_sessions_user" ON "shared_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_shared_sessions_session" ON "shared_sessions" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_shared_sessions_token" ON "shared_sessions" ("share_token");

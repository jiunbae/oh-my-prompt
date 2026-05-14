-- Tool invocations table: per-turn record of agent tool_use calls
-- (Bash commands, Edit/Write/Read, WebFetch, etc.) parented to a prompt row.
CREATE TABLE IF NOT EXISTS "tool_invocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prompt_id" uuid REFERENCES "prompts"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "team_id" uuid REFERENCES "teams"("id") ON DELETE CASCADE,
  "session_id" varchar(255) NOT NULL,
  "sequence" integer NOT NULL DEFAULT 0,
  "source" varchar(50),
  "tool_name" varchar(100) NOT NULL,
  "tool_use_id" varchar(255) NOT NULL,
  "input_json" jsonb,
  "program" varchar(100),
  "cwd" text,
  "timestamp" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "tool_invocations_session_tool_use_unique" UNIQUE ("session_id", "tool_use_id")
);

CREATE INDEX IF NOT EXISTS "idx_tool_invocations_prompt" ON "tool_invocations"("prompt_id");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_session" ON "tool_invocations"("session_id", "sequence");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_user_ts" ON "tool_invocations"("user_id", "timestamp");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_team_ts" ON "tool_invocations"("team_id", "timestamp");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_tool" ON "tool_invocations"("tool_name");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_program" ON "tool_invocations"("program");

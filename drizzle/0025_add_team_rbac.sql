-- P7-3: Granular team RBAC
-- Add visibility to prompts
ALTER TABLE "prompts" ADD COLUMN "visibility" varchar(20) DEFAULT 'private';
CREATE INDEX "idx_prompts_team_visibility" ON "prompts" ("team_id", "visibility");

-- Create prompt_permissions table
CREATE TABLE "prompt_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prompt_id" uuid NOT NULL REFERENCES "prompts"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "permission" varchar(20) NOT NULL, -- 'view', 'edit', 'admin'
  "granted_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX "idx_prompt_permissions_prompt" ON "prompt_permissions" ("prompt_id");
CREATE INDEX "idx_prompt_permissions_user" ON "prompt_permissions" ("user_id");
CREATE UNIQUE INDEX "idx_prompt_permissions_prompt_user" ON "prompt_permissions" ("prompt_id", "user_id");

-- Create team_settings table
CREATE TABLE "team_settings" (
  "team_id" uuid PRIMARY KEY REFERENCES "teams"("id") ON DELETE CASCADE,
  "invite_only" boolean DEFAULT false,
  "default_prompt_visibility" varchar(20) DEFAULT 'team', -- 'private', 'team', 'public'
  "allow_member_invites" boolean DEFAULT false,
  "require_approval_for_join" boolean DEFAULT false,
  "updated_at" timestamp with time zone DEFAULT now()
);

-- Seed team_settings for existing teams with default values
INSERT INTO "team_settings" ("team_id", "invite_only", "default_prompt_visibility", "allow_member_invites", "require_approval_for_join")
SELECT "id", false, 'team', false, false FROM "teams" ON CONFLICT DO NOTHING;

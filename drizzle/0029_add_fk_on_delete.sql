-- Add ON DELETE behavior to hot foreign keys that were previously NO ACTION.
--   * prompts.user_id       -> ON DELETE CASCADE   (user-owned rows)
--   * prompts.team_id       -> ON DELETE SET NULL  (prompt survives team deletion)
--   * ai_insights.user_id   -> ON DELETE CASCADE
--   * analytics_daily.user_id -> ON DELETE CASCADE
-- Each FK is dropped (all historically-possible constraint names) then re-added.

-- prompts.user_id -> users.id (CASCADE)
ALTER TABLE "prompts" DROP CONSTRAINT IF EXISTS "prompts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT IF EXISTS "prompts_user_id_fkey";--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- prompts.team_id -> teams.id (SET NULL)
ALTER TABLE "prompts" DROP CONSTRAINT IF EXISTS "prompts_team_id_teams_id_fk";--> statement-breakpoint
ALTER TABLE "prompts" DROP CONSTRAINT IF EXISTS "prompts_team_id_fkey";--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ai_insights.user_id -> users.id (CASCADE)
ALTER TABLE "ai_insights" DROP CONSTRAINT IF EXISTS "ai_insights_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "ai_insights" DROP CONSTRAINT IF EXISTS "ai_insights_user_id_fkey";--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- analytics_daily.user_id -> users.id (CASCADE)
ALTER TABLE "analytics_daily" DROP CONSTRAINT IF EXISTS "analytics_daily_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "analytics_daily" DROP CONSTRAINT IF EXISTS "fk_analytics_daily_user";--> statement-breakpoint
ALTER TABLE "analytics_daily" DROP CONSTRAINT IF EXISTS "analytics_daily_user_id_fkey";--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

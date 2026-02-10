CREATE TABLE "allowed_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "allowed_emails_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sync_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"auto_sync_enabled" boolean DEFAULT false,
	"sync_interval_minutes" integer DEFAULT 10,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sync_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100),
	"is_admin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "minio_sync_log" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "minio_sync_log" ADD COLUMN "sync_type" varchar(20);--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "response_text" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "response_length" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "source" varchar(50);--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "device_name" varchar(255);--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "token_estimate_response" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "word_count_response" integer;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "search_vector" "tsvector";--> statement-breakpoint
ALTER TABLE "allowed_emails" ADD CONSTRAINT "allowed_emails_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_settings" ADD CONSTRAINT "sync_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_token" ON "users" USING btree ("token");--> statement-breakpoint
ALTER TABLE "minio_sync_log" ADD CONSTRAINT "minio_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prompts_user" ON "prompts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_prompts_search_vector" ON "prompts" USING gin ("search_vector");
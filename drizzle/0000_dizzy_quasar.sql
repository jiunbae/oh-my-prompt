CREATE TABLE "analytics_daily" (
	"date" date PRIMARY KEY NOT NULL,
	"prompt_count" integer DEFAULT 0,
	"total_chars" integer DEFAULT 0,
	"total_tokens_est" integer DEFAULT 0,
	"unique_projects" integer DEFAULT 0,
	"avg_prompt_length" numeric(10, 2) DEFAULT '0',
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "minio_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'running',
	"files_processed" integer DEFAULT 0,
	"files_added" integer DEFAULT 0,
	"files_skipped" integer DEFAULT 0,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "prompt_tags" (
	"prompt_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "prompt_tags_prompt_id_tag_id_pk" PRIMARY KEY("prompt_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minio_key" varchar(255) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"working_directory" varchar(500),
	"prompt_length" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"project_name" varchar(255),
	"prompt_type" varchar(50),
	"token_estimate" integer,
	"word_count" integer,
	"synced_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "prompts_minio_key_unique" UNIQUE("minio_key")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "prompt_tags" ADD CONSTRAINT "prompt_tags_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_tags" ADD CONSTRAINT "prompt_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prompts_timestamp" ON "prompts" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_prompts_project" ON "prompts" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "idx_prompts_type" ON "prompts" USING btree ("prompt_type");--> statement-breakpoint
CREATE INDEX "idx_prompts_minio_key" ON "prompts" USING btree ("minio_key");
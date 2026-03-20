CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_expires" ON "password_reset_tokens" USING btree ("expires_at");

-- Template marketplace tables
CREATE TABLE IF NOT EXISTS "template_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "prompt_templates"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "content" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_template_versions_template" ON "template_versions"("template_id");
CREATE INDEX IF NOT EXISTS "idx_template_versions_template_version" ON "template_versions"("template_id", "version");

CREATE TABLE IF NOT EXISTS "template_marketplace" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "prompt_templates"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" varchar(50) NOT NULL,
  "tags" text[],
  "rating" numeric(3, 2) DEFAULT '0',
  "rating_count" integer DEFAULT 0,
  "fork_count" integer DEFAULT 0,
  "is_public" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_marketplace_template" ON "template_marketplace"("template_id");
CREATE INDEX IF NOT EXISTS "idx_marketplace_user" ON "template_marketplace"("user_id");
CREATE INDEX IF NOT EXISTS "idx_marketplace_category" ON "template_marketplace"("category");
CREATE INDEX IF NOT EXISTS "idx_marketplace_public" ON "template_marketplace"("is_public");

CREATE TABLE IF NOT EXISTS "template_ratings" (
  "template_id" uuid NOT NULL REFERENCES "prompt_templates"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rating" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("template_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_template_ratings_template" ON "template_ratings"("template_id");

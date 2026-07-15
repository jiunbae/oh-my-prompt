-- Older migration runners could swallow a failed CREATE EXTENSION statement
-- and still record 0016 as applied. Repair those databases explicitly now that
-- deployments use the pgvector image, while remaining a no-op on healthy DBs.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS embedding vector(384);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prompts_embedding
  ON prompts USING ivfflat (embedding vector_cosine_ops);

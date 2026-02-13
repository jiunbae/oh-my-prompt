-- Prompt enrichment columns
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_score INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS topic_tags TEXT[];
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_prompts_quality ON prompts (quality_score);
CREATE INDEX IF NOT EXISTS idx_prompts_enriched ON prompts (enriched_at);

-- AI insights cache table
CREATE TABLE IF NOT EXISTS ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  insight_type VARCHAR(100) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  data_hash VARCHAR(64) NOT NULL,
  result JSONB NOT NULL,
  model VARCHAR(100),
  tokens_used INTEGER,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_user_type ON ai_insights (user_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_ai_insights_expires ON ai_insights (expires_at);

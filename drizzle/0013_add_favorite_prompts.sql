-- Migration: add favorite_prompts table
-- Created: 2026-05-05

CREATE TABLE IF NOT EXISTS favorite_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_prompts_user_prompt ON favorite_prompts(user_id, prompt_id);
CREATE INDEX IF NOT EXISTS idx_favorite_prompts_user ON favorite_prompts(user_id);

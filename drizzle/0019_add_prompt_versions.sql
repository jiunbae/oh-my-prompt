-- Migration: add prompt_versions table
-- Created: 2026-05-05

CREATE TABLE IF NOT EXISTS prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  response_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reason VARCHAR(100) DEFAULT 'user_edit'
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_prompt_version ON prompt_versions(prompt_id, version);

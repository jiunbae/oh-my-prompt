CREATE TABLE IF NOT EXISTS prompt_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  token VARCHAR(32) NOT NULL UNIQUE,
  access VARCHAR(20) NOT NULL DEFAULT 'read',
  expires_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_shares_token ON prompt_shares(token);
CREATE INDEX IF NOT EXISTS idx_prompt_shares_prompt ON prompt_shares(prompt_id);

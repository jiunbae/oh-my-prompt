CREATE TABLE slack_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  webhook_url TEXT NOT NULL,
  channel VARCHAR(100),
  events VARCHAR(100)[] DEFAULT ARRAY['daily_summary'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_slack_webhooks_user ON slack_webhooks(user_id);
CREATE INDEX idx_slack_webhooks_team ON slack_webhooks(team_id);

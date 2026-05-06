-- Migration: Add outgoing integrations and delivery logs tables
-- idx: 19 (next after 0022_add_onboarding in journal, but journal has mixed ordering)

CREATE TABLE IF NOT EXISTS outgoing_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    webhook_url TEXT NOT NULL,
    secret TEXT,
    events TEXT[] NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outgoing_integrations_user ON outgoing_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_integrations_team ON outgoing_integrations(team_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_integrations_provider ON outgoing_integrations(provider);

CREATE TABLE IF NOT EXISTS integration_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES outgoing_integrations(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB,
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_logs_integration ON integration_delivery_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_integration_logs_delivered ON integration_delivery_logs(delivered_at);

CREATE TABLE IF NOT EXISTS session_display_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_display_names_user_session
  ON session_display_names (user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_session_display_names_user_updated
  ON session_display_names (user_id, updated_at);

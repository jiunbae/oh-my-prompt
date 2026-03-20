CREATE TABLE IF NOT EXISTS favorite_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_sessions_user_session
  ON favorite_sessions (user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_favorite_sessions_user
  ON favorite_sessions (user_id);

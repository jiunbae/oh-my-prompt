-- Migration: Add prompt_experiments and experiment_results tables
-- Created: 2026-05-06

CREATE TABLE IF NOT EXISTS prompt_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft',
  baseline_version INTEGER NOT NULL,
  challenger_version INTEGER NOT NULL,
  win_metric VARCHAR(50) DEFAULT 'quality_score',
  min_samples INTEGER DEFAULT 10,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  winner_version INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_experiments_prompt ON prompt_experiments(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_experiments_user ON prompt_experiments(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_experiments_status ON prompt_experiments(status);

CREATE TABLE IF NOT EXISTS experiment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES prompt_experiments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  metric_value NUMERIC(5,2),
  sample_size INTEGER DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment ON experiment_results(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment_version ON experiment_results(experiment_id, version);

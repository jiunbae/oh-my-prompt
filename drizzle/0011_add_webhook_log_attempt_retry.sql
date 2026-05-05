-- Add attempt and retryOf columns to webhook_logs for retry tracking
ALTER TABLE webhook_logs
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS retry_of UUID;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_retry_of ON webhook_logs(retry_of);

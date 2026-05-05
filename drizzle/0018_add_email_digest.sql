-- Add email digest preference to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_digest_enabled BOOLEAN NOT NULL DEFAULT true;

-- Add data retention policy column to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS data_retention_days INTEGER NOT NULL DEFAULT 365;

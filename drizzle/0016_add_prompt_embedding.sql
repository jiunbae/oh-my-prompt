-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to prompts table
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Create ivfflat index for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_prompts_embedding ON prompts USING ivfflat (embedding vector_cosine_ops);

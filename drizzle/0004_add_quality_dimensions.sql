-- Quality dimension columns for multi-dimensional scoring
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_clarity INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_specificity INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_context INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_constraints INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_structure INTEGER;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS quality_details JSONB;

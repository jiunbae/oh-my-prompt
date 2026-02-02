# Prompt Analytics Dashboard - Data Schema

## MinIO Source Data

### Bucket Structure
```
claude-prompts/
├── 2026/
│   ├── 01/
│   │   ├── 29/
│   │   │   ├── abc123def456.json
│   │   │   └── ...
│   │   ├── 30/
│   │   └── 31/
│   └── 02/
│       ├── 01/
│       └── 02/
```

### Prompt JSON Schema
```typescript
interface MinioPrompt {
  timestamp: string;           // ISO 8601: "2026-02-02T05:19:51Z"
  working_directory: string;   // "/Users/username/project/path"
  prompt_length: number;       // Character count
  prompt: string;              // Actual prompt text
}
```

### Current Statistics
- **Total Prompts**: 507
- **Total Size**: 510 KiB
- **Date Range**: 2026-01-29 ~ 2026-02-02
- **Average Size**: ~1KB per prompt

---

## Database Schema (PostgreSQL)

### Core Tables

```sql
-- Prompts table (main entity)
CREATE TABLE prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    minio_key VARCHAR(255) NOT NULL UNIQUE,  -- "2026/02/02/abc123.json"
    timestamp TIMESTAMPTZ NOT NULL,
    working_directory VARCHAR(500),
    prompt_length INTEGER NOT NULL,
    prompt_text TEXT NOT NULL,

    -- Extracted metadata
    project_name VARCHAR(255),               -- Extracted from working_directory
    prompt_type VARCHAR(50),                 -- 'user_input', 'task_notification', 'system'

    -- Analytics fields
    token_estimate INTEGER,                  -- Estimated tokens (~4 chars per token)
    word_count INTEGER,

    -- Sync tracking
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Full-text search
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(project_name, '')), 'A') ||
        setweight(to_tsvector('english', prompt_text), 'B')
    ) STORED
);

-- Indexes
CREATE INDEX idx_prompts_timestamp ON prompts(timestamp DESC);
CREATE INDEX idx_prompts_project ON prompts(project_name);
CREATE INDEX idx_prompts_type ON prompts(prompt_type);
CREATE INDEX idx_prompts_search ON prompts USING GIN(search_vector);
CREATE INDEX idx_prompts_minio_key ON prompts(minio_key);

-- Tags table
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(7) DEFAULT '#6366f1',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt tags junction
CREATE TABLE prompt_tags (
    prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (prompt_id, tag_id)
);

-- Daily aggregations (materialized)
CREATE TABLE analytics_daily (
    date DATE PRIMARY KEY,
    prompt_count INTEGER DEFAULT 0,
    total_chars INTEGER DEFAULT 0,
    total_tokens_est INTEGER DEFAULT 0,
    unique_projects INTEGER DEFAULT 0,
    avg_prompt_length NUMERIC(10,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync log
CREATE TABLE minio_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'running',  -- running, completed, failed
    files_processed INTEGER DEFAULT 0,
    files_added INTEGER DEFAULT 0,
    files_skipped INTEGER DEFAULT 0,
    error_message TEXT
);
```

---

## Data Transformation

### Extract Project Name
```typescript
function extractProjectName(workingDirectory: string): string | null {
  // Pattern: /Users/username/workspace/{project}/...
  // or: /Users/username/{project}/...
  const match = workingDirectory.match(/\/Users\/username\/(?:workspace\/)?([^\/]+)/);
  return match ? match[1] : null;
}
```

### Detect Prompt Type
```typescript
function detectPromptType(prompt: string): 'task_notification' | 'system' | 'user_input' {
  if (prompt.includes('<task-notification>')) return 'task_notification';
  if (prompt.includes('<system-reminder>')) return 'system';
  return 'user_input';
}
```

### Estimate Tokens
```typescript
function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}
```

---

## Sample Queries

### Recent prompts with project
```sql
SELECT
    id, timestamp, project_name, prompt_type,
    LEFT(prompt_text, 100) as preview,
    prompt_length
FROM prompts
ORDER BY timestamp DESC
LIMIT 20;
```

### Daily statistics
```sql
SELECT
    DATE(timestamp) as date,
    COUNT(*) as prompt_count,
    SUM(prompt_length) as total_chars,
    COUNT(DISTINCT project_name) as projects
FROM prompts
GROUP BY DATE(timestamp)
ORDER BY date DESC;
```

### Full-text search
```sql
SELECT
    id, timestamp, project_name,
    ts_headline('english', prompt_text, query) as highlight,
    ts_rank(search_vector, query) as rank
FROM prompts, plainto_tsquery('english', 'authentication bug') as query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 10;
```

### Project breakdown
```sql
SELECT
    project_name,
    COUNT(*) as prompt_count,
    SUM(prompt_length) as total_chars,
    MIN(timestamp) as first_prompt,
    MAX(timestamp) as last_prompt
FROM prompts
WHERE project_name IS NOT NULL
GROUP BY project_name
ORDER BY prompt_count DESC;
```

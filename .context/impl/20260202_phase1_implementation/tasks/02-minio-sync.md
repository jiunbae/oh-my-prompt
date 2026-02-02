# Task: MinIO Sync Worker

## Context
Build the data synchronization layer that fetches prompts from MinIO and stores them in PostgreSQL.

## Reference Documents
- `/Users/username/workspace/prompt-manager/.context/impl/20260202_174951_prompt-analytics-dashboard/DATA_SCHEMA.md`

## MinIO Configuration
- **Endpoint**: minio.example.com
- **Bucket**: claude-prompts
- **Structure**: `{year}/{month}/{day}/{uuid}.json`

## Prompt JSON Schema
```typescript
interface MinioPrompt {
  timestamp: string;           // ISO 8601
  working_directory: string;
  prompt_length: number;
  prompt: string;
}
```

## Deliverables

### 1. MinIO Client Setup
Create `src/lib/minio.ts`:
```typescript
import { Client } from 'minio';

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT!,
  port: 443,
  useSSL: true,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});
```

### 2. Sync Service
Create `src/services/sync.ts` with functions:
- `listAllObjects(bucket: string)` - List all JSON files in bucket
- `fetchPrompt(key: string)` - Fetch and parse single prompt
- `extractMetadata(prompt, key)` - Extract project_name, prompt_type, token_estimate
- `syncAll()` - Full sync: list objects, check existing, insert new
- `syncIncremental(since: Date)` - Sync only new files

### 3. Helper Functions
```typescript
// Extract project name from working_directory
function extractProjectName(dir: string): string | null {
  const match = dir.match(/\/Users\/username\/(?:workspace\/)?([^\/]+)/);
  return match ? match[1] : null;
}

// Detect prompt type
function detectPromptType(prompt: string): 'task_notification' | 'system' | 'user_input' {
  if (prompt.includes('<task-notification>')) return 'task_notification';
  if (prompt.includes('<system-reminder>')) return 'system';
  return 'user_input';
}

// Estimate tokens
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

### 4. API Route for Manual Sync
Create `src/app/api/sync/route.ts`:
- POST /api/sync - Trigger full sync
- GET /api/sync/status - Get last sync status

## Output Location
Write all files directly to `/Users/username/workspace/prompt-manager/`

## Success Criteria
- Can connect to MinIO and list objects
- Can parse prompt JSON correctly
- Sync function inserts/updates prompts in database

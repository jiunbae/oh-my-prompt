# Task: Project Setup + Database Schema

## Context
Initialize the Prompt Analytics Dashboard project with Next.js 14+ and set up the database layer.

## Reference Documents
- `/Users/username/workspace/prompt-manager/.context/impl/20260202_174951_prompt-analytics-dashboard/PROPOSAL.md`
- `/Users/username/workspace/prompt-manager/.context/impl/20260202_174951_prompt-analytics-dashboard/DATA_SCHEMA.md`

## Deliverables

### 1. Initialize Next.js Project
```bash
# In /Users/username/workspace/prompt-manager
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

### 2. Install Dependencies
```bash
pnpm add drizzle-orm postgres @trpc/server @trpc/client @trpc/react-query @tanstack/react-query zod minio
pnpm add -D drizzle-kit @types/node
pnpm add @radix-ui/react-slot class-variance-authority clsx tailwind-merge lucide-react
```

### 3. Create Database Schema
Create `src/db/schema.ts` with:
- prompts table (id, minio_key, timestamp, working_directory, prompt_length, prompt_text, project_name, prompt_type, token_estimate, search_vector)
- tags table
- prompt_tags junction table
- analytics_daily table
- minio_sync_log table

### 4. Setup Drizzle Config
Create `drizzle.config.ts` for migrations

### 5. Create tRPC Setup
- `src/server/trpc.ts` - tRPC initialization
- `src/server/routers/_app.ts` - Root router
- `src/server/routers/prompts.ts` - Prompts router stub

### 6. Environment Setup
Create `.env.example` with required variables:
- DATABASE_URL
- MINIO_ENDPOINT
- MINIO_ACCESS_KEY
- MINIO_SECRET_KEY
- AUTH_SECRET

## Output Location
Write all files directly to `/Users/username/workspace/prompt-manager/`

## Success Criteria
- Project initializes without errors
- Database schema compiles
- tRPC router structure in place

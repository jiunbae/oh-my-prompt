# Prompt Analytics Dashboard - Architecture Design

## Executive Summary

This document outlines the architecture for a personal Prompt Analytics Dashboard that ingests, processes, and visualizes Claude Code conversation data stored in MinIO. The design prioritizes simplicity, cost-effectiveness, and modern development practices while remaining extensible for future enhancements.

---

## 1. System Architecture

### 1.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Next.js Frontend (SPA)                           │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │    │
│  │  │Dashboard │  │ Search   │  │Analytics │  │ Prompt Detail    │    │    │
│  │  │  View    │  │  View    │  │  Charts  │  │     View         │    │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Next.js API Routes / tRPC                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │    │
│  │  │ Prompts  │  │ Search   │  │Analytics │  │    Sync          │    │    │
│  │  │   API    │  │   API    │  │   API    │  │    API           │    │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐
│    DATA LAYER         │ │   SEARCH LAYER    │ │     CACHE LAYER           │
│  ┌─────────────────┐  │ │  ┌─────────────┐  │ │  ┌─────────────────────┐  │
│  │   PostgreSQL    │  │ │  │  Meilisearch│  │ │  │       Redis         │  │
│  │   + pgvector    │  │ │  │  (optional) │  │ │  │   (optional)        │  │
│  └─────────────────┘  │ │  └─────────────┘  │ │  └─────────────────────┘  │
└───────────────────────┘ └───────────────────┘ └───────────────────────────┘
                    ▲
                    │
┌───────────────────────────────────────────────────────────────────────────┐
│                          DATA INGESTION LAYER                              │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        Sync Worker                                   │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌────────────────────┐    │  │
│  │  │ MinIO Client │───▶│  Transformer │───▶│  Database Writer   │    │  │
│  │  └──────────────┘    └──────────────┘    └────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
                    ▲
                    │
┌───────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCE                              │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                     MinIO (minio.example.com)                           │  │
│  │                   Claude Code Conversation Data                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Breakdown

| Component | Purpose | Technology |
|-----------|---------|------------|
| **Frontend** | User interface for viewing prompts and analytics | Next.js 14+ with App Router |
| **API Layer** | Business logic, data access, authentication | Next.js API Routes + tRPC |
| **Primary Database** | Structured data storage, analytics queries | PostgreSQL with pgvector |
| **Search Engine** | Full-text search (Phase 2) | Meilisearch or PostgreSQL FTS |
| **Cache** | Query caching, session storage (Phase 2) | Redis or in-memory |
| **Sync Worker** | Data ingestion from MinIO | Node.js worker process |
| **MinIO Client** | S3-compatible storage access | MinIO SDK |

### 1.3 Data Flow Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW SEQUENCE                               │
└─────────────────────────────────────────────────────────────────────────┘

1. INGESTION FLOW (Scheduled/Manual)
   ┌─────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────────┐
   │  MinIO  │───▶│ Sync Worker │───▶│ Transform  │───▶│  PostgreSQL  │
   └─────────┘    └─────────────┘    └────────────┘    └──────────────┘
                         │                                      │
                         ▼                                      ▼
                  [List Objects]                    [Upsert Conversations]
                  [Download New]                   [Update Search Index]
                  [Track Cursor]

2. READ FLOW (User Request)
   ┌─────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────────┐
   │ Browser │───▶│   Next.js   │───▶│   tRPC     │───▶│  PostgreSQL  │
   └─────────┘    └─────────────┘    └────────────┘    └──────────────┘
                                            │
                                            ▼
                                    [Query & Aggregate]
                                    [Apply Filters]
                                    [Paginate Results]

3. ANALYTICS FLOW
   ┌─────────┐    ┌─────────────┐    ┌────────────────────────────────┐
   │ Browser │───▶│ Analytics   │───▶│ PostgreSQL Aggregation Views  │
   └─────────┘    │   Request   │    │  (Materialized for performance)│
                  └─────────────┘    └────────────────────────────────┘
```

---

## 2. Backend Tech Stack Recommendation

### 2.1 Language/Framework: TypeScript + Next.js

**Rationale:**
- **Full-stack TypeScript**: Single language across frontend and backend, type safety end-to-end
- **Next.js App Router**: Modern React with server components, API routes, and middleware
- **tRPC Integration**: Type-safe API calls without code generation
- **Ecosystem**: Rich tooling, excellent DX, strong community support
- **Deployment flexibility**: Vercel, Docker, self-hosted options

**Alternative Considered:** FastAPI (Python) - Better for ML/data processing, but adds complexity for a single-developer project.

### 2.2 Database Selection: PostgreSQL with Extensions

**Primary: PostgreSQL 16+**

Rationale:
- Handles structured data, time-series, and full-text search in one system
- **pgvector** extension for semantic search (embedding-based)
- **pg_trgm** for fuzzy text matching
- Materialized views for pre-computed analytics
- JSON/JSONB support for flexible schema evolution
- Cost-effective: single database reduces operational overhead

**Configuration:**
```sql
-- Essential extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

**Why not dedicated search (Elasticsearch/Meilisearch)?**
- For MVP with single user, PostgreSQL FTS is sufficient
- Can add Meilisearch in Phase 2 if search becomes bottleneck
- Reduces infrastructure complexity

### 2.3 Caching Strategy

**Phase 1 (MVP):** In-memory caching via Next.js
- Use `unstable_cache` / React `cache()` for server-side caching
- Simple LRU cache for expensive computations

**Phase 2:** Redis (optional)
- Add when analytics queries become slow
- Cache aggregated statistics with TTL
- Session storage for future multi-device support

```typescript
// Example: Server-side caching pattern
import { unstable_cache } from 'next/cache';

const getCachedAnalytics = unstable_cache(
  async (userId: string, range: string) => {
    return db.analytics.aggregate({ userId, range });
  },
  ['analytics'],
  { revalidate: 3600 } // 1 hour
);
```

### 2.4 API Design: tRPC (with REST fallback)

**Primary: tRPC**

Rationale:
- End-to-end type safety
- No API schema to maintain separately
- Automatic input validation with Zod
- Batching and caching built-in
- Excellent Next.js integration

```typescript
// Example tRPC router structure
export const appRouter = router({
  prompts: router({
    list: protectedProcedure
      .input(z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        filters: promptFiltersSchema.optional(),
      }))
      .query(async ({ input, ctx }) => {
        return promptService.list(input, ctx.userId);
      }),

    getById: protectedProcedure
      .input(z.string().uuid())
      .query(async ({ input, ctx }) => {
        return promptService.getById(input, ctx.userId);
      }),
  }),

  analytics: router({
    overview: protectedProcedure
      .input(dateRangeSchema)
      .query(async ({ input, ctx }) => {
        return analyticsService.getOverview(input, ctx.userId);
      }),

    tokenUsage: protectedProcedure
      .input(dateRangeSchema)
      .query(async ({ input, ctx }) => {
        return analyticsService.getTokenUsage(input, ctx.userId);
      }),
  }),

  sync: router({
    trigger: protectedProcedure
      .mutation(async ({ ctx }) => {
        return syncService.triggerSync(ctx.userId);
      }),

    status: protectedProcedure
      .query(async ({ ctx }) => {
        return syncService.getStatus(ctx.userId);
      }),
  }),
});
```

**REST Fallback:** For webhook integrations or external tools, expose key endpoints as REST.

---

## 3. Data Pipeline Design

### 3.1 MinIO to Processing to Storage Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SYNC PIPELINE                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Trigger    │
│  (Scheduled  │
│  or Manual)  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 1: DISCOVER                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  MinIO.listObjects(bucket, { since: lastSyncCursor })            │    │
│  │  → Returns list of new/modified conversation files               │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 2: EXTRACT                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  For each object:                                                 │    │
│  │    - MinIO.getObject(bucket, key)                                │    │
│  │    - Parse JSON/JSONL conversation data                          │    │
│  │    - Validate schema                                             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 3: TRANSFORM                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  - Extract metadata (timestamp, model, session_id)               │    │
│  │  - Calculate token counts (if not present)                       │    │
│  │  - Extract conversation turns (user/assistant)                   │    │
│  │  - Categorize/tag prompts (Phase 2: ML-based)                   │    │
│  │  - Generate embeddings for semantic search (Phase 2)            │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 4: LOAD                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  - Upsert conversations (on conflict: update)                    │    │
│  │  - Insert conversation_turns                                     │    │
│  │  - Update sync_cursor                                            │    │
│  │  - Refresh materialized views (async)                            │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 5: INDEX (Phase 2)                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  - Update full-text search index                                 │    │
│  │  - Update vector embeddings index                                │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 ETL vs ELT Decision

**Recommendation: ELT (Extract, Load, Transform)**

Rationale:
- Raw data preserved in PostgreSQL (JSONB column)
- Transformations can be refined without re-extraction
- Easier debugging and schema evolution
- PostgreSQL handles transformation efficiently

```sql
-- Example: Store raw, transform via views
CREATE TABLE conversations_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minio_key TEXT UNIQUE NOT NULL,
  raw_data JSONB NOT NULL,
  extracted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Materialized view for transformed data
CREATE MATERIALIZED VIEW conversations_processed AS
SELECT
  id,
  raw_data->>'session_id' AS session_id,
  (raw_data->>'timestamp')::timestamptz AS timestamp,
  raw_data->>'model' AS model,
  (raw_data->>'input_tokens')::int AS input_tokens,
  (raw_data->>'output_tokens')::int AS output_tokens,
  raw_data->'messages' AS messages
FROM conversations_raw;
```

### 3.3 Processing Mode: Hybrid (Scheduled Batch + On-Demand)

**Primary: Scheduled Batch**
- Cron job runs every 15-30 minutes
- Processes all new files since last cursor
- Updates analytics materialized views

**Secondary: On-Demand Sync**
- User can trigger manual sync from dashboard
- Useful after intense coding sessions
- Rate-limited to prevent abuse

```typescript
// Sync scheduler configuration
const syncConfig = {
  scheduled: {
    interval: '*/15 * * * *', // Every 15 minutes
    enabled: true,
  },
  manual: {
    cooldownSeconds: 300, // 5-minute cooldown between manual syncs
  },
  batch: {
    size: 100, // Process 100 files per batch
    parallelism: 5, // 5 concurrent downloads
  },
};
```

---

## 4. Key Backend Features

### 4.1 Authentication Approach

**Recommendation: Single-User with Optional OAuth**

**Phase 1 (MVP):** Simple password authentication
- Single admin user configured via environment variable
- JWT tokens for session management
- Secure cookie storage

```typescript
// Simple auth configuration
const authConfig = {
  type: 'password',
  passwordHash: process.env.ADMIN_PASSWORD_HASH,
  jwtSecret: process.env.JWT_SECRET,
  sessionDuration: '7d',
};
```

**Phase 2:** OAuth integration (optional)
- Add GitHub/Google OAuth for convenience
- Useful if sharing with small team later
- Use NextAuth.js for implementation

```typescript
// NextAuth.js configuration (Phase 2)
export const authOptions: AuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Whitelist check
      return allowedEmails.includes(user.email!);
    },
  },
};
```

### 4.2 API Rate Limiting

**Implementation: In-Memory + Sliding Window**

```typescript
import { Ratelimit } from '@upstash/ratelimit';

// Rate limit configuration
const rateLimits = {
  api: {
    requests: 100,
    window: '1m',
  },
  sync: {
    requests: 1,
    window: '5m',
  },
  search: {
    requests: 30,
    window: '1m',
  },
};

// Middleware implementation
export async function rateLimitMiddleware(req: Request) {
  const identifier = getClientIdentifier(req);
  const endpoint = getEndpointType(req.url);

  const limit = rateLimits[endpoint] || rateLimits.api;
  const result = await ratelimiter.limit(identifier, limit);

  if (!result.success) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'X-RateLimit-Limit': limit.requests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.reset.toString(),
      },
    });
  }
}
```

### 4.3 Data Retention Policies

```typescript
const retentionPolicies = {
  // Conversation data retention
  conversations: {
    rawData: '2 years',     // Keep raw MinIO data reference
    processedData: '2 years',
    searchIndex: '2 years',
  },

  // Analytics retention (aggregated)
  analytics: {
    hourly: '30 days',      // Detailed hourly stats
    daily: '1 year',        // Daily aggregations
    monthly: 'forever',     // Monthly summaries
  },

  // System data
  system: {
    syncLogs: '30 days',
    auditLogs: '90 days',
    errorLogs: '30 days',
  },
};
```

**Retention Implementation:**

```sql
-- Automated cleanup via pg_cron
SELECT cron.schedule(
  'cleanup-old-analytics',
  '0 3 * * *',  -- Daily at 3 AM
  $$
    DELETE FROM analytics_hourly
    WHERE recorded_at < NOW() - INTERVAL '30 days';

    DELETE FROM sync_logs
    WHERE created_at < NOW() - INTERVAL '30 days';
  $$
);
```

---

## 5. Implementation Phases

### Phase 1: MVP (4 weeks)

**Goal:** Basic prompt viewing and navigation

#### Week 1: Foundation
- [ ] Project setup (Next.js, PostgreSQL, Prisma/Drizzle)
- [ ] Database schema design and migrations
- [ ] MinIO client configuration
- [ ] Basic authentication (password-based)

#### Week 2: Data Pipeline
- [ ] Sync worker implementation
- [ ] Data extraction from MinIO
- [ ] Basic transformation logic
- [ ] Manual sync trigger endpoint

#### Week 3: Core API
- [ ] tRPC router setup
- [ ] Prompts list/detail endpoints
- [ ] Basic filtering (date, model)
- [ ] Pagination implementation

#### Week 4: Basic UI
- [ ] Dashboard layout
- [ ] Prompts list view
- [ ] Prompt detail view
- [ ] Basic date filtering

**MVP Deliverables:**
- View all prompts in chronological order
- Filter by date range
- View individual prompt details
- Manual data sync from MinIO

---

### Phase 2: Analytics (4 weeks)

**Goal:** Insights and search capabilities

#### Week 5: Analytics Foundation
- [ ] Materialized views for aggregations
- [ ] Token usage tracking
- [ ] Daily/weekly/monthly statistics
- [ ] Analytics API endpoints

#### Week 6: Visualization
- [ ] Time-series charts (Recharts/Tremor)
- [ ] Token usage breakdown
- [ ] Model usage distribution
- [ ] Activity heatmap

#### Week 7: Search
- [ ] PostgreSQL full-text search setup
- [ ] Search API endpoint
- [ ] Search UI with filters
- [ ] Search result highlighting

#### Week 8: Polish
- [ ] Performance optimization
- [ ] Query caching
- [ ] Loading states and error handling
- [ ] Mobile responsiveness

**Phase 2 Deliverables:**
- Token usage analytics dashboard
- Usage patterns over time charts
- Full-text search across prompts
- Cached analytics queries

---

### Phase 3: Advanced Features (4 weeks)

**Goal:** Intelligence and sharing

#### Week 9: Semantic Search
- [ ] Embedding generation (OpenAI/local model)
- [ ] pgvector index setup
- [ ] Semantic search API
- [ ] Hybrid search (keyword + semantic)

#### Week 10: Categorization
- [ ] Topic extraction (LLM-based)
- [ ] Auto-tagging system
- [ ] Category management UI
- [ ] Filtering by category

#### Week 11: Export & Share
- [ ] Export to markdown/JSON
- [ ] Shareable prompt links (with auth)
- [ ] Template extraction
- [ ] Prompt collections/favorites

#### Week 12: Advanced Analytics
- [ ] Prompt effectiveness metrics
- [ ] Pattern detection
- [ ] Recommendations
- [ ] Custom dashboards

**Phase 3 Deliverables:**
- Semantic search ("find prompts about React hooks")
- Auto-categorization of prompts
- Export and sharing features
- Advanced analytics and insights

---

## 6. Infrastructure Recommendations

### Development Environment

```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: prompt_analytics
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Optional: Local MinIO for testing
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    command: server /data --console-address ":9001"

volumes:
  postgres_data:
```

### Production Deployment Options

**Option 1: Vercel + Neon (Recommended for simplicity)**
- Frontend/API: Vercel (free tier sufficient)
- Database: Neon PostgreSQL (free tier: 0.5GB)
- Sync Worker: Vercel Cron or external cron

**Option 2: Self-Hosted (Full control)**
- VPS: Hetzner/DigitalOcean (~$5/month)
- Docker Compose deployment
- Caddy for reverse proxy + SSL
- PostgreSQL in container

**Option 3: Hybrid**
- Frontend: Vercel
- Database: Self-hosted PostgreSQL
- Better for larger data volumes

### Environment Configuration

```bash
# .env.example
# Database
DATABASE_URL="postgresql://user:pass@host:5432/prompt_analytics"

# MinIO
MINIO_ENDPOINT="minio.example.com"
MINIO_ACCESS_KEY="your-access-key"
MINIO_SECRET_KEY="your-secret-key"
MINIO_BUCKET="claude-prompts"

# Auth
ADMIN_PASSWORD_HASH="$argon2id$..."
JWT_SECRET="your-jwt-secret"

# Optional: Analytics
OPENAI_API_KEY="sk-..."  # For embeddings (Phase 3)
```

---

## 7. Security Considerations

### Data Security
- All MinIO credentials stored as environment variables
- Database connections use SSL
- API endpoints require authentication
- Input validation on all endpoints (Zod schemas)

### Network Security
- HTTPS only (enforced by middleware)
- CORS configuration for frontend origin only
- CSP headers for XSS protection

### Access Control
- Single-user authentication initially
- Future: Role-based access for sharing features
- Audit logging for sensitive operations

---

## 8. Monitoring & Observability

### Logging Strategy
```typescript
// Structured logging
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty', // Dev only
  },
});

// Key events to log
logger.info({ event: 'sync_started', cursor: lastCursor });
logger.info({ event: 'sync_completed', processed: count, duration: ms });
logger.error({ event: 'sync_failed', error: err.message });
```

### Metrics (Phase 2+)
- Sync success/failure rate
- API response times
- Database query performance
- Token usage over time

### Health Checks
```typescript
// /api/health endpoint
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    minio: await checkMinioConnection(),
    lastSync: await getLastSyncTime(),
  };

  const healthy = Object.values(checks).every(c => c.status === 'ok');

  return Response.json(checks, { status: healthy ? 200 : 503 });
}
```

---

## 9. Appendix: Technology Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Next.js 14+ | Full-stack, excellent DX, App Router |
| Language | TypeScript | Type safety, single language |
| Database | PostgreSQL | Versatile, handles all data needs |
| ORM | Drizzle ORM | Type-safe, lightweight, fast |
| API | tRPC | End-to-end type safety |
| Validation | Zod | Runtime validation, TypeScript integration |
| Auth | Custom JWT / NextAuth | Simple initially, extensible |
| Search | PostgreSQL FTS | Sufficient for single user, reduces complexity |
| Caching | Next.js built-in | Simple, effective for MVP |
| Deployment | Vercel + Neon | Cost-effective, zero-ops |

---

## 10. Open Questions

1. **MinIO Data Structure**: Need to investigate the actual format of Claude Code conversation data in MinIO to finalize the schema.

2. **Token Counting**: Does the data include token counts, or do we need to calculate them using tiktoken/similar?

3. **Historical Data**: How much historical data exists? This affects initial sync strategy and database sizing.

4. **Embedding Model**: For semantic search, use OpenAI embeddings (cost) vs local model (self-hosted overhead)?

5. **Multi-device Sync**: Is there a need to sync Claude Code data from multiple machines?

---

*Document prepared by: Claude Architecture Agent*
*Last updated: 2026-02-02*

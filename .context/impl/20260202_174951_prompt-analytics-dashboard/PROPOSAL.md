# Prompt Analytics Dashboard - Unified Proposal

> **Generated**: 2026-02-02 (Updated)
> **Phase**: Planning
> **Status**: Ready for Implementation
> **Deployment**: Self-hosted (Docker)

---

## Executive Summary

A personal dashboard service to analyze and visualize Claude Code prompts stored in MinIO. The system will provide detailed prompt views, usage analytics, search capabilities, and actionable insights from your conversation history.

---

## 1. Project Overview

### Problem Statement
You have valuable data from Claude Code sessions stored in MinIO (minio.example.com) but lack visibility into:
- Prompt patterns and effectiveness
- Token usage trends
- Topic clustering and categorization
- Search across historical conversations

### Solution
A modern web dashboard that ingests data from MinIO and provides:
- **Prompt Browser**: List, filter, and view all prompts
- **Analytics Dashboard**: Usage trends, token consumption, activity patterns
- **Smart Search**: Full-text and semantic search across prompts
- **Insights**: Auto-categorization, pattern detection, effectiveness metrics

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                               │
│    Next.js 14+ Frontend (React Server Components)           │
│    ┌──────────┬──────────┬──────────┬──────────┐           │
│    │Dashboard │ Prompts  │Analytics │ Search   │           │
│    └──────────┴──────────┴──────────┴──────────┘           │
└─────────────────────────────────────────────────────────────┘
                              │ tRPC
┌─────────────────────────────────────────────────────────────┐
│                       API LAYER                              │
│              Next.js API Routes + tRPC                       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  PostgreSQL   │    │    Redis      │    │  Meilisearch  │
│  + pgvector   │    │   (cache)     │    │  (optional)   │
└───────────────┘    └───────────────┘    └───────────────┘
        ▲
        │ Sync Worker
┌───────────────────────────────────────────────────────────┐
│                   MinIO (minio.example.com)                   │
│                Claude Code Conversation Data               │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | Next.js 14+ (App Router) | Server components, streaming, great DX |
| **UI Library** | shadcn/ui + Tailwind | Accessible, customizable, performant |
| **State** | tRPC + TanStack Query | Type-safe, cache-managed server state |
| **API** | tRPC | End-to-end TypeScript type safety |
| **Database** | PostgreSQL 16+ | Robust, supports pgvector, pg_trgm |
| **ORM** | Drizzle | Type-safe, performant, great migrations |
| **Vector Search** | pgvector | Semantic similarity without extra infra |
| **Cache** | Redis (optional) | Query caching for Phase 2 |
| **Charts** | Tremor / Recharts | Dashboard-ready visualization |

---

## 4. Data Source (MinIO)

### Current Statistics
| Metric | Value |
|--------|-------|
| **Bucket** | `claude-prompts` |
| **Total Prompts** | 507 |
| **Total Size** | 510 KiB |
| **Date Range** | 2026-01-29 ~ present |

### Storage Structure
```
claude-prompts/
└── {year}/
    └── {month}/
        └── {day}/
            └── {uuid}.json
```

### Prompt JSON Schema
```json
{
  "timestamp": "2026-02-02T05:19:51Z",
  "working_directory": "/Users/username/project/path",
  "prompt_length": 387,
  "prompt": "... actual prompt text ..."
}
```

---

## 5. Database Model

### Core Tables
| Table | Purpose |
|-------|---------|
| `prompts` | Main prompt data with search vectors |
| `tags` | Categorization labels |
| `prompt_tags` | Many-to-many junction |
| `analytics_daily` | Pre-aggregated daily metrics |
| `minio_sync_log` | Track sync state |

### Extracted Metadata
- **project_name**: From `working_directory` (e.g., "prompt-manager")
- **prompt_type**: `user_input`, `task_notification`, `system`
- **token_estimate**: ~4 chars per token

See `DATA_SCHEMA.md` for complete SQL schema.

---

## 6. Key Features

### Phase 1: MVP (Core Viewing)
- [ ] MinIO sync worker (manual trigger)
- [ ] Prompt list view with pagination
- [ ] Prompt detail view with full conversation
- [ ] Basic filtering (date, session)
- [ ] Responsive layout with dark mode
- [ ] Simple password auth

### Phase 2: Analytics
- [ ] Token usage charts (daily, weekly trends)
- [ ] Activity heatmap (GitHub-style)
- [ ] Full-text search with PostgreSQL
- [ ] Tag system for categorization
- [ ] Command palette (⌘K)
- [ ] Automatic sync (15-min intervals)

### Phase 3: Intelligence
- [ ] Semantic search with pgvector
- [ ] Auto-categorization using embeddings
- [ ] Pattern detection (common prompts)
- [ ] Export to Markdown/JSON
- [ ] Shareable prompt links
- [ ] Custom dashboard widgets

---

## 7. UI Design

### Dashboard Layout
```
┌─────────────────────────────────────────────────────────┐
│  ☰  Prompt Analytics                    🔍  ⚙️  👤     │
├────────┬────────────────────────────────────────────────┤
│        │                                                │
│  📊    │   ┌─────────────────────────────────────┐     │
│  Home  │   │  Total Prompts    Token Usage       │     │
│        │   │     1,234          2.4M tokens      │     │
│  💬    │   └─────────────────────────────────────┘     │
│ Prompts│                                                │
│        │   ┌─────────────────────────────────────┐     │
│  📈    │   │  Recent Prompts                     │     │
│Analytics│  │  ┌─────────────────────────────┐   │     │
│        │   │  │ Fix authentication bug...   │   │     │
│  🔍    │   │  │ 2h ago · 1.2k tokens       │   │     │
│ Search │   │  └─────────────────────────────┘   │     │
│        │   │  ┌─────────────────────────────┐   │     │
│  ⚙️    │   │  │ Add user dashboard...       │   │     │
│Settings│   │  │ Yesterday · 3.4k tokens     │   │     │
│        │   │  └─────────────────────────────┘   │     │
└────────┴───┴─────────────────────────────────────┴─────┘
```

### Key Views
1. **Prompt List**: Grid/list toggle, sorting, quick preview
2. **Prompt Detail**: Full conversation thread, metadata, related prompts
3. **Analytics**: Charts, heatmaps, usage breakdown
4. **Search**: Full-text with filters, instant results

---

## 8. Implementation Roadmap

### Phase 1: Foundation (4 weeks)
```
Week 1: Project setup, database schema, MinIO integration
Week 2: API layer (tRPC), basic CRUD operations
Week 3: Frontend scaffolding, prompt list/detail views
Week 4: Auth, responsive design, manual sync, testing
```

### Phase 2: Analytics (4 weeks)
```
Week 5: Aggregation tables, background jobs
Week 6: Analytics API endpoints, chart components
Week 7: Full-text search, tag system
Week 8: Command palette, auto-sync, polish
```

### Phase 3: Intelligence (4 weeks)
```
Week 9:  Vector embeddings setup, semantic search
Week 10: Auto-categorization, pattern detection
Week 11: Export features, sharing
Week 12: Custom dashboards, optimization
```

---

## 9. Infrastructure (Self-Hosted)

### Stack
```
┌──────────────────────────────────────┐
│         Caddy (Reverse Proxy)        │
│        prompts.example.com (HTTPS)      │
└────────────────┬─────────────────────┘
                 │
┌────────────────┼─────────────────────┐
│          Docker Compose              │
│  ┌─────────────┴────────────────┐    │
│  │  Next.js App ◄──► PostgreSQL │    │
│  │    :3100          :5432      │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
                 │
         MinIO (existing)
        minio.example.com
```

### Requirements
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Storage | 5 GB | 10 GB |

### Key Files
- `docker-compose.yml` - Service orchestration
- `Dockerfile` - Next.js standalone build
- `Caddyfile` - Reverse proxy + HTTPS
- `.env.production` - Secrets

See `INFRASTRUCTURE.md` for complete deployment guide.

---

## 10. Decisions Made

| Question | Decision |
|----------|----------|
| **MinIO Structure** | ✅ Investigated: `{year}/{month}/{day}/{uuid}.json` |
| **Deployment** | ✅ Self-hosted with Docker |
| **Authentication** | Simple password (personal use) |
| **Domain** | `prompts.example.com` |

### Open Questions
1. **Mobile Priority**: Desktop-primary or responsive?
2. **Sync Frequency**: Manual, 15-min, or real-time?

---

## 11. Next Steps

1. ✅ Planning complete
2. ✅ MinIO data structure analyzed
3. ✅ Self-hosted infrastructure designed
4. ⬜ **Review and approve proposal**
5. ⬜ Initialize project repository
6. ⬜ Begin Phase 1 implementation

---

## Appendix: Detailed Documents

### Planning Perspectives
- `perspectives/claude-architecture.md` - Backend architecture details
- `perspectives/codex-datamodel.md` - Database schema (generic)
- `perspectives/gemini-frontend.md` - UI/UX specifications

### Concrete Specifications
- `DATA_SCHEMA.md` - **Actual MinIO schema + PostgreSQL tables**
- `INFRASTRUCTURE.md` - **Self-hosted Docker deployment**

---

*Generated by multi-agent planning with Claude perspectives*
*Updated with concrete MinIO analysis and self-hosted infrastructure*

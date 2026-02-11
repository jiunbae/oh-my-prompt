# OMP Extensions & Insights — Design Proposal

> Extract insights from prompt data via a lightweight extension system.

## 1. Landscape Analysis

### 1.1 LLM Observability Platforms

| Tool | Key Insights | Delivery | Extension Model |
|------|-------------|----------|-----------------|
| **Helicone** | Cost/token tracking, latency, user behavior, prompt A/B testing | Real-time dashboards, geographic analytics | Proxy gateway (1-line integration) |
| **LangSmith** | Token usage, latency P50/P99, semantic intent, agent trajectories, failure modes | Custom dashboards, **AI "Insights Agent"** auto-discovers patterns | SDK tracing, webhooks, REST API |
| **Langfuse** (OSS) | Cost/latency by user/session/feature/model, eval scores, session replay | Customizable dashboards, metrics API, batch exports | OpenTelemetry, webhooks, Slack/GitHub |
| **Braintrust** | Agent traces (every LLM/tool call), automated evals, cost analytics | Trace inspector, CI/CD eval integration, leaderboards | 13+ framework integrations, REST API |
| **W&B Weave** | Auto-tracked LLM calls, cost/latency, accuracy scoring | Interactive playground, experiment comparison | Python decorator, custom scorers |

**Notable**: LangSmith's "Insights Agent" — an AI that auto-analyzes all your traces and surfaces patterns/anomalies/recommendations. Most relevant reference for OMP.

### 1.2 Developer Productivity Analytics

| Tool | Key Insights | Notable Feature |
|------|-------------|-----------------|
| **WakaTime** | Coding time by project/language/editor, leaderboards | Open-source plugin model for 60+ editors, "heartbeat" architecture |
| **LinearB** | DORA metrics, SPACE framework, PR review times | 8.1M+ PRs benchmarked across 4,800 teams |
| **Swarmia** | DORA/SPACE + AI tool adoption rates | Measures Copilot/Cursor/Claude Code impact |

### 1.3 AI Coding Assistant Analytics

| Tool | Metrics | Delivery |
|------|---------|----------|
| **GitHub Copilot** | Active users, acceptance rates, lines added/deleted, model usage | Built-in dashboard + Metrics API + NDJSON export |
| **Cursor** | Suggestions presented, acceptance rate, code origin (AI vs human) | Admin Panel + Admin API |
| **Sourcegraph Cody** | Completion metrics, chat usage | Built-in analytics dashboard |

### 1.4 Common Insight Categories

| Category | Examples | OMP Data Available? |
|----------|---------|-------------------|
| Usage Patterns | Prompts/day, peak hours, session length, active projects | Yes |
| Cost/Token Tracking | Token usage trends, input vs output ratio | Yes |
| Quality Signals | Prompt clarity, response usefulness, prompt/response ratio | Partial (lengths, word counts, text) |
| Productivity | Prompts per session, response rate, project velocity | Yes |
| Behavioral | Topic categorization, common patterns, tool usage | Yes (text available for LLM analysis) |
| Trends | Week-over-week changes, project lifecycle phases | Yes |

---

## 2. Extension Architecture Patterns

### 2.1 Industry Survey

| Pattern | Used By | Complexity | Best For |
|---------|---------|-----------|----------|
| Convention-based static registration | dbt, Superset | Low | Small-medium apps (**recommended**) |
| Central registry file | Superset MainPreset | Low | Chart/card plugin types |
| Middleware pipeline | Express, Next.js, n8n | Medium | Data processing chains |
| Contribution points (manifest) | VS Code | Medium | Declarative plugin capabilities |
| Event-driven hooks | VS Code lifecycle | Medium | Cross-cutting concerns |
| Dynamic plugin loader | Grafana, Backstage | High | Third-party ecosystems |

### 2.2 Key Lessons

1. **Backstage (Spotify) 2025 rewrite**: Original plugin system was too complex for adopters. Rewrote to make "hello world" trivially easy. **Start simple.**
2. **Grafana DataFrames**: All plugins output the same standardized format. Any data source works with any panel. **Define a canonical `InsightResult` type early.**
3. **dbt packages**: Extensions = just more project directories (SQL + YAML). No runtime loader. **Extensions should be directories following a convention, not a new runtime concept.**
4. **Notion AI**: Does NOT use a single giant prompt. Leverages structured data to build focused, scoped prompts per task. **Query relevant subsets, not everything.**

### 2.3 Recommended: Convention-Based Static Registration

```
src/extensions/
  types.ts                 # Extension interface, InsightResult type
  registry.ts              # Central registration (single file imports all extensions)
  daily-summary/
    manifest.ts            # name, schedule, description
    processor.ts           # Data fetch + LLM call + Zod validation
    card.tsx               # Dashboard UI component
  weekly-trends/
    manifest.ts
    processor.ts
    card.tsx
  prompt-quality/
    manifest.ts
    processor.ts
    card.tsx
```

No dynamic loader. Extensions are static imports registered in one file.

---

## 3. LLM-Powered Insight Generation

### 3.1 Data Pipeline

```
DB Query (scoped subset)
  → Aggregate to compact form
  → JSON payload to LLM
  → Zod schema validation
  → Cache in ai_insights table
```

Rules:
- **JSON format** for LLM input (>99% schema adherence vs free text)
- **Separate reasoning from formatting**: Let LLM reason first, structure output second
- **Prompt chaining** for complex analysis: summarize → anomalies → recommendations
- **Schema-first**: Provide expected output JSON schema in the prompt, validate with Zod

### 3.2 Batch vs Real-Time (Hybrid)

| | Batch | Real-Time |
|---|---|---|
| When | Cron (daily/weekly via BullMQ) | On-demand per user request |
| Cost | Low (bulk processing, cheaper models) | Higher (per-request) |
| Freshness | Hours stale | Always current |
| Best for | Dashboard cards, reports, digests | Interactive Q&A, drill-downs |

**Approach**: Batch for dashboard insight cards (daily cron). On-demand for "ask a question" and drill-downs.

### 3.3 Caching

Start with **exact-match cache** in a DB table:

```sql
CREATE TABLE ai_insights (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  insight_type  TEXT NOT NULL,       -- 'daily_summary', 'weekly_trends', etc.
  parameters    JSONB NOT NULL,      -- query params that produced this
  data_hash     TEXT NOT NULL,       -- hash of input data for invalidation
  result        JSONB NOT NULL,      -- validated LLM output
  model         TEXT,                -- which LLM generated this
  generated_at  TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL
);
```

Upgrade to semantic caching (vector similarity) only if free-form natural language queries are added later.

### 3.4 LLM Provider Strategy

Model-agnostic. Users configure their own API key:

```
extensions.llm.provider: "anthropic" | "openai" | "ollama"
extensions.llm.apiKey: "sk-..."
extensions.llm.model: "claude-sonnet-4-5-20250929"
extensions.llm.baseUrl: "http://localhost:11434"  # for local ollama
```

OMP does not pay for LLM costs. Users bring their own key.

---

## 4. Extension Interface Contract

```typescript
// src/extensions/types.ts

export interface InsightResult {
  title: string;
  summary: string;
  trends?: Array<{
    metric: string;
    direction: "up" | "down" | "stable";
    magnitude: number;
    explanation: string;
  }>;
  recommendations?: string[];
  highlights?: Array<{ label: string; value: string | number }>;
  confidence: number;  // 0-1
  generatedAt: string; // ISO timestamp
}

export interface ProcessorInput {
  userId: string;
  dateRange: { from: string; to: string };
  parameters?: Record<string, unknown>;
}

export interface Extension {
  name: string;
  version: string;
  description: string;

  // Batch processing (BullMQ cron)
  processor?: {
    schedule?: string;    // cron expression, e.g. "0 3 * * *"
    jobName: string;
    handler: (input: ProcessorInput) => Promise<InsightResult>;
  };

  // API (tRPC router)
  router?: AnyRouter;

  // UI (dashboard card component)
  dashboardCard?: React.ComponentType<{
    insight: InsightResult | null;
    loading: boolean;
    onRefresh: () => void;
  }>;
}
```

---

## 5. Suggested Extensions (Priority Order)

| # | Extension | Type | Description | Complexity |
|---|-----------|------|-------------|-----------|
| 1 | **Daily Summary** | Batch (daily) | "Today: 47 prompts, focused on oh-my-prompt refactoring. Peak hour: 2-3pm." | Low |
| 2 | **Weekly Trends** | Batch (weekly) | "Prompt volume up 23% WoW. New project: IaC. Response rate improved." | Low |
| 3 | **Prompt Quality Score** | Batch (per-prompt) | Rate prompt clarity/specificity 1-10 with improvement tips | Medium |
| 4 | **Topic Categorization** | Batch (per-prompt) | Auto-tag: "debugging", "feature", "refactoring", "devops", "docs" | Medium |
| 5 | **Session Story** | On-demand | "Started with bug investigation, escalated to refactor, ended with deploy" | Medium |
| 6 | **Project Health** | Batch (weekly) | Per-project velocity, complexity trends, common patterns | Medium |
| 7 | **Ask Your Data** | On-demand | Free-form: "What did I work on last week?" | High |

---

## 6. Implementation Phases

### Phase 1 — Foundation

- Define `Extension`, `InsightResult`, `ProcessorInput` types
- Add Drizzle migration for `ai_insights` table
- Set up BullMQ cron job worker for batch extension processing
- Create `src/extensions/registry.ts` with extension registration
- Add tRPC `insights` router (`src/server/routers/insights.ts`)
- Add LLM provider config to settings

### Phase 2 — First Extensions

- Implement `daily-summary` extension (aggregate stats -> LLM -> cache)
- Implement `weekly-trends` extension
- Replace dashboard "Coming Soon" cards with real insight cards
- Show staleness indicator + manual refresh button

### Phase 3 — Per-Prompt Enrichment

- Add `quality_score`, `topic_tags` columns to prompts table
- Enrich on upload (post-process hook in `upload.ts`) or batch backfill
- Quality distribution chart in analytics page
- Topic filter/breakdown in analytics page

### Phase 4 — Interactive Insights

- On-demand insight generation via tRPC mutation
- `session-story` extension
- Streaming response for "ask your data"
- Semantic caching if query volume justifies it

---

## 7. Current OMP Extension Points

These are the natural places to integrate:

| Layer | Location | Integration |
|-------|----------|-------------|
| DB Schema | `src/db/schema.ts` | Add `aiInsights` table |
| Upload Pipeline | `src/services/upload.ts` | Post-process hook for per-prompt enrichment |
| Analytics Service | `src/lib/analytics.ts` | Feed aggregated data to extensions |
| tRPC Router | `src/server/routers/_app.ts` | Merge `insightsRouter` |
| REST API | `src/app/api/insights/` | New API routes |
| Dashboard UI | `src/app/(dashboard)/dashboard/page.tsx` | Replace "Coming Soon" cards |
| Analytics UI | `src/app/(dashboard)/analytics/page.tsx` | Add insight sections |
| Background Jobs | BullMQ workers | Cron-triggered batch processing |
| Config | `src/env.ts` | Feature flags, LLM provider settings |

---

## 8. Design Principles

1. **Convention over configuration** — Extensions are directories, not runtime plugins
2. **Standard data contract** — All extensions produce `InsightResult`
3. **Batch-first, on-demand-second** — Dashboard cards via cron, interactive via mutation
4. **BYOK (Bring Your Own Key)** — Users configure their own LLM provider
5. **Schema-validated LLM output** — Never trust unstructured output in production
6. **Cache aggressively** — Exact-match first, semantic later
7. **Scoped queries** — Feed relevant subsets to LLM, not entire history

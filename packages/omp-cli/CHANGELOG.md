# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

## [2026.728.1] - 2026-07-28

### Fixed
- Cap uploaded tool invocations at 1000 per record to match the server upload schema. A single long agentic session with more tool calls than the limit made the server reject the whole chunk with HTTP 400, stalling `omp sync` and `omp sync backfill` at the same point on every run. The full list is still kept locally

## [2026.715.1] - 2026-07-15

### Performance
- Parallelize transcript parsing with a worker pool for faster ingest/backfill on large histories
- Push stats aggregations down into SQL instead of computing them in JS
- Index the dedup hot path and restore FTS4 word-level search

### Fixed
- Atomic SQLite writes and fail-fast on legacy FTS5 databases to prevent corruption
- Capture Codex activity via array-form top-level `notify` hook
- Harden security, background-job, capture, and DB audit paths

## [2026.514.1] - 2026-05-14

### Added
- Track every agent tool call (Bash, Edit, Write, Read, WebFetch, etc.) as its own row in a new `tool_invocations` table, parented to the prompt. Bash commands have an extracted `program` column (e.g. `npm`, `git`) so you can answer "which programs did the agent run"
- Cross-CLI coverage: Claude Code Stop hook collects `tool_use` blocks from the transcript; OpenCode plugin walks `parts[]` and accepts tools-only assistant turns; Codex notify hook tail-reads `~/.codex/sessions/.../rollout-*.jsonl` for `function_call`; Gemini AfterAgent hook mines `~/.gemini/tmp/<projectHash>/chats/session-*.json`
- SQLite migration v5 with unique `(session_id, tool_use_id)` index for idempotent upsert; CLI sync passes a `tools[]` array along with each prompt upload, server `/api/sync/upload` persists them with `ON CONFLICT DO NOTHING`

### Safety
- Tool inputs are clipped at 32KB per field in every hook to keep large `Edit`/`WebFetch` payloads from overflowing the stdin pipe to `omp ingest`

## [2026.505.5] - 2026-05-06

### Added
- Outgoing integrations: Zapier/Make.com webhook triggers with HMAC signing
- Template marketplace with ratings, forks, categories, and public discovery
- Granular team RBAC: per-prompt permissions, invite-only teams, visibility levels
- Prompt A/B testing: compare versions with quality metric tracking and auto-conclusion
- Custom alerts & thresholds: rule engine for prompt count, quality, token usage with email/Slack/in-app
- PWA offline support: service worker, cache-first API fallback, install prompt, offline indicators

## [2026.505.4] - 2026-05-05

### Added
- Real-time team activity feed with SSE streaming (`/teams/[id]/activity`)
- Shareable prompt links with token-based access (`read`/`clone`) and expiry
- Slack integration: daily summaries, real-time new-prompt alerts, webhook settings
- Analytics dashboard with 6 chart types (volume, tokens, quality, projects, hourly, weekday)
- AI-powered prompt suggestions: semantic similarity + LLM rewrite suggestions
- First-run onboarding wizard with step persistence and confetti celebration

## [2026.505.3] - 2026-05-05

### Added
- `omp tui` — interactive terminal UI for browsing, searching, favoriting, and deleting prompts
- `omp import --chatgpt` — import ChatGPT conversation exports (JSON/CSV)
- `--semantic` flag for `omp search` — server-side vector search via pgvector embeddings
- Teams support in CLI: `--team-id` flag for scoped sync, stats, and search

## [2026.505.2] - 2026-05-05

### Added
- Keyboard shortcuts (`g` chords, `/` search, `?` help) across the web app
- Bulk operations bar for multi-select delete and tag in session threads
- Webhook retry scheduler with exponential backoff (1m → 5m → 30m → 2h → 12h)
- Data retention policy with automatic soft-delete of expired prompts
- Session notes per conversation thread

## [2026.505.1] - 2026-05-05

### Added
- Soft delete (`deleted_at`) for prompts with restore capability
- Full-text search filters: project, source, date range, team
- Command-line completions (bash/zsh/fish)
- `omp export --format json|csv|md` for prompt exports
- Mobile-responsive layout improvements

## [2026.505.0] - 2026-05-05

### Added
- Favorite prompts with star toggle in UI and CLI
- Real-time file watcher (`omp watch`) for transcript auto-ingestion
- Admin monitoring dashboard with webhook health and rate-limit stats
- Prompt diff viewer (side-by-side and inline)
- Public documentation page (`/docs`) with searchable API reference

## [2026.218.2] - 2026-03-09

### Added
- `omp stats --view <preset>` presets for `overview`, `projects`, `sources`, `hourly`, `weekday`, and `sessions`
- richer local-only analytics including session summaries, activity streaks, peak hour, and weekday patterns

### Changed
- redesigned `omp stats` output into a dashboard-style CLI layout with summary cards and bar lists
- expanded `omp stats --group-by` support to `day`, `week`, `month`, `project`, `source`, `hour`, and `weekday`

## [0.1.0] - 2026-02-08

### Added
- Initial public release on npm
- Full CLI with 15+ commands (install, sync, stats, report, etc.)
- Claude Code and Codex hook installation
- SQLite local storage with automatic migrations
- Server sync for multi-device support
- Prompt quality analysis and scoring
- Export to JSONL, CSV, JSON formats
- Import from Codex history
- Configuration via CLI, file, or env vars
- Automatic secret redaction
- Queue system for offline resilience
- Comprehensive README and documentation

### Fixed
- None (initial release)

### Changed
- None (initial release)

### Removed
- None (initial release)

---

[Unreleased]: https://github.com/jiunbae/oh-my-prompt/compare/v2026.218.2...HEAD
[2026.218.2]: https://github.com/jiunbae/oh-my-prompt/releases/tag/v2026.218.2
[0.1.0]: https://github.com/jiunbae/oh-my-prompt/releases/tag/v0.1.0

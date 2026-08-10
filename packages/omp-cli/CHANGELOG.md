# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

## [2026.810.1] - 2026-08-10

### Performance
- Capture no longer rewrites the whole database several times per turn. sql.js serialises the entire file on every save outside a transaction, and the `tool_invocations` insert loop did one save *per tool call* — a single agentic turn could write hundreds of gigabytes and hold the ingest lock for minutes. The prompt, FTS mirror, response, and every tool invocation now share one atomic transaction: 42 full-file rewrites for a 40-tool turn became exactly 1, unchanged duplicate captures perform no rewrite, and a 200-tool capture went from ~9 minutes to 18.6s on a 285MB database
- `transaction()` now honours batch mode instead of forcing a save, so the above does not make `omp backfill` persist once per file
- `omp ingest --replay` took the lock and reopened the database for every queued payload — roughly 55 items/hour, starving `omp backfill` and `omp sync` of the lock throughout. It now takes the lock once and keeps a single handle in batch mode: a 2141-item queue went from an estimated 39 hours to 1m27s
- `omp sync` no longer loads the entire prompts table into memory when it has no checkpoint (a fresh device, or the cursor reset after a backfill). Rows are fetched 2000 at a time and the lock is released between pages. A separate keyset scan cursor ensures historical rows updated after the checkpoint cannot fill the first page and permanently starve later rows; dry runs now traverse every page too
- Sync loads at most the server-supported tool-invocation limit plus one marker row per prompt instead of materialising an unbounded tool history only to truncate it before upload
- Sync checkpoints follow the later of a prompt's creation or response-update time, so late responses upload once instead of being re-sent on every run. Checkpoints are persisted once per fetched page (and on failure) rather than once per HTTP chunk, avoiding repeated full-database rewrites while preserving accepted progress
- Index `prompts(updated_at)` (migration v11). Incremental sync selects on it to find rows whose response arrived after the checkpoint, but every existing index covered `created_at`, so that arm of the query scanned the table

### Fixed
- `omp backfill` released the database lock between each of its four sources, so a hook-spawned `omp ingest` could claim it in a gap and fail the rest of the run with `OMP_DB_BUSY`. One session is now held for the whole run
- Separate the lock-acquisition deadline by caller. Hooks still give up after 10s and queue the payload, because the editor is blocked on them; `omp backfill` and `omp sync` now wait up to 15 minutes and report what they are waiting on, instead of failing while capture is simply busy
- Delete a replayed queue file only after its rows are flushed to disk. The previous order could lose payloads if the process died between the in-memory write and the flush
- Sweep abandoned `omp.db.tmp-<pid>` files. A writer killed mid-save never reaches its own cleanup, and each leftover is as large as the database; 63 had accumulated to 9.0GB. Files are judged by age rather than whether their PID is alive, because PIDs get recycled
- Clear a stale `OMP_DB_BUSY` status after the ingest queue drains successfully, and have `omp doctor` derive its latest migration version from the database migration registry instead of reporting the obsolete hard-coded v4

## [2026.805.4] - 2026-08-05

### Fixed
- `omp install --cli codex` reported success while capturing nothing — `omp status` showed `codex=installed` and no record ever reached the database. Three independent defects, each sufficient on its own:
  - The pre-existing `notify` value was stored in `notify-chain.json` as raw TOML text rather than argv, then run through `sh -lc` as an invalid command, so the chained notify never fired. `parseTomlValue` reached `JSON.parse` first, which rejects the trailing comma in the multi-line array Codex writes, and its `toml` fallback is not a dependency of the published CLI. TOML string arrays are now parsed directly — trailing commas, interior comments and literal strings included — with no optional dependency
  - The wrapper ran the chained command with a blocking `spawnSync` *before* its own capture. Notify programs are under no obligation to exit (the Codex Computer Use client stays resident), so `notify.js` was never reached. Chained commands now run detached; only the ingest stays synchronous
  - Both the wrapper and the `notify` line in `config.toml` invoked a bare `"node"`. Codex spawns notify directly, so a version-managed node only resolves when Codex inherited a shell PATH carrying it. Both now use absolute paths, and the wrapper pins `PATH`/`OMP_BIN` from its own interpreter. Existing bare-node lines are repointed in place, without re-chaining them

## [2026.805.3] - 2026-08-05

### Fixed
- `omp sync` could move its checkpoint *backwards*. `fetchRows` also returns backfilled rows — created before the checkpoint but updated after it, e.g. a response attached by a later Stop hook — and orders them ahead of new rows because both sort by `created_at`. Committing each chunk verbatim (added in 2026.805.1) dragged the checkpoint back to the older row's timestamp, so every later run re-fetched from that earlier point. Checkpoint commits now only ever move forward

## [2026.805.2] - 2026-08-05

### Fixed
- `omp doctor` printed `[object Object]` for the signed-in user on the Server line. `/api/auth/me` returns `user` as an object, so the raw value was interpolated into the status string; it now shows the email (falling back to name or id)

## [2026.805.1] - 2026-08-05

### Fixed
- `omp sync` failed with `Server error (429)` and could never recover. The server allows 100 requests/minute per user, but 429 was absent from the CLI's no-retry list and `isTransientStatus` only matched 5xx, so it fell through to the generic `status >= 400` throw. Because the sync checkpoint advanced only once — after every chunk succeeded — that throw discarded all progress and the next run replayed the whole backlog into the same limit. 429 now has its own retry budget and honours the server's `Retry-After`
- Advance the sync checkpoint after every fully accepted chunk, so a run interrupted partway keeps its progress. The existing guard against advancing past a 207 partial success is unchanged
- Pace upload requests at 90/minute (`sync.maxRequestsPerMinute`) to stay under the server budget instead of discovering it via 429s
- Keep the reduced chunk size for the rest of the run after a 413, rather than re-discovering the body limit — and burning an extra request — on every chunk

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

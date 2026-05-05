# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2026.505.2] - 2026-05-05

### Added
- **CLI**: `omp watch` for real-time transcript directory monitoring with debounce and daemon mode
- **Session notes**: Per-session markdown notes with GET/POST/DELETE API and editable UI
- **Prompt favorites**: Individual prompt starring, favorites listing page, sidebar link
- **Data retention**: Per-user configurable retention days with automatic cleanup
- **Admin monitoring**: Rate limit status, webhook health, sync overview, system health dashboard
- **API docs**: Searchable endpoint reference page with curl examples, OpenAPI 3.0 JSON endpoint at `/api/openapi`

### Migration
- `0012_add_session_notes` — Add `session_notes` table
- `0013_add_favorite_prompts` — Add `favorite_prompts` table
- `0015_add_data_retention` — Add `data_retention_days` to users table

## [2026.505.1] - 2026-05-05

### Added
- **Redis rate limiting**: Atomic Lua script (ZADD+ZREMRANGEBYSCORE+ZCARD+PEXPIRE) replaces in-memory limiter; graceful fallback when Redis unavailable
- **CLI**: `omp templates list/show/render/create/delete` with `--json` support
- **Bulk operations**: Multi-select prompts for batch delete/tag in session detail; `POST /api/prompts/bulk` endpoint
- **Keyboard shortcuts**: `g`-prefix chord navigation (`g+d/s//a/i/t/x`), `/` for search, `?` for help overlay, `Escape` to dismiss
- **Webhook retry**: Exponential backoff (1m→5m→30m→2h→12h) for failed deliveries; manual retry endpoint `POST /api/webhooks/[id]/retry`
- **Doctor**: Server connectivity, DB health (table/row counts, integrity check), disk space, migration version, config file validation

### Improved
- **CLI doctor**: Structured per-check output with latency, version, user info for server; file size and index listing for DB

## [2026.505.0] - 2026-05-05

### Added
- **Soft delete**: Prompts use `deletedAt` instead of hard delete; admin purge endpoint for 30-day cleanup
- **Search**: Pagination, project/source/date filters, URL persistence, filter badges
- **CLI**: `omp completions bash/zsh/install` for shell tab-completion
- **Export**: Streaming batches (prevents OOM), `--fields` selection, `--gzip` compression, CSV injection protection, progress indicator

### Improved
- **Mobile UX**: Admin users card layout, 44px touch targets, compact search results, full-width filters

### Migration
- `0010_add_soft_delete` — Add `deleted_at` column to prompts table

## [2026.331.3] - 2026-03-31

### Fixed
- **CLI**: Fix `omp search --stats` crash after FTS removal
- **CLI**: Add batch mode and proper resource cleanup to all backfill functions (Codex, OpenCode, Gemini)

## [2026.331.2] - 2026-03-31

### Fixed
- **CLI**: Fix assistant response capture — sql.js FTS4 content-table `delete` command is broken, causing silent "SQL logic error" on every UPDATE. Remove FTS triggers entirely; search falls back to LIKE queries

## [2026.331.1] - 2026-03-31

### Performance
- **CLI**: ~10x faster `omp backfill` — batch mode skips per-write disk flushes, reuses single DB connection across all turns
- **CLI**: Add progress indicators for `omp backfill` (file count) and `omp sync` (chunk count)

### Fixed
- **CLI**: Fix `omp backfill` and `omp sync` hanging indefinitely after sql.js migration — add explicit `process.exit()` since WebAssembly context keeps the event loop alive

## [2026.320.3] - 2026-03-20

### Changed
- **CLI**: Migrate from `better-sqlite3` (native C++) to `sql.js` (WebAssembly) — no more node-gyp or Xcode CLT required
- **CLI**: `openDb()` is now async; all callers updated
- **CLI**: FTS5 → FTS4 fallback for search (sql.js default build includes FTS4)
- **CLI**: Search gracefully falls back to LIKE queries when FTS is unavailable

## [2026.320.2] - 2026-03-20

### Fixed
- **Sync**: Auto-split chunks on 413 (request too large) — automatically retries with 1/4 sized sub-chunks
- **Sync**: Reduce default chunk size from 500 to 200 to avoid hitting server body limits
- **Sync**: Fix error message wrapping that incorrectly showed "after N retries" for non-retry errors
- **Deploy**: Add missing `DATABASE_URL` to dev overlay configmap (fixed CrashLoopBackOff)

## [2026.320.1] - 2026-03-20

### Added
- **Analytics**: Date range picker with presets (7d/30d/90d/365d/custom) and project filter dropdown
- **Sessions**: Favorite/star sessions with dedicated "Favorites" tab
- **CLI**: `omp delete <id>` command with `--all-session` support
- **CLI**: `omp tag <id> <name>` command with `--remove` and `--list` options
- **Admin**: User stats — prompts, tokens, storage, last login (relative time) in users table
- **Sharing**: Auto-cleanup expired shares (piggyback on sync, max once/hour)
- **Sharing**: Admin endpoint `POST /api/admin/cleanup-shares` for manual cleanup
- **Daemon**: Log rotation — 5MB max, keep 3 rotated backups

## [2026.320.0] - 2026-03-20

### Added
- **Auth**: Password reset flow — forgot-password page, admin reset tokens (1-hour expiry), reset page
- **Auth**: Session invalidation on password change (`passwordChangedAt` + `iat` comparison)
- **CLI**: `omp search <query>` — local FTS5 full-text search with `--exact`, `--project`, `--json`, `--stats`
- **Sync**: Retry with exponential backoff (3 retries, 1s/2s/4s with jitter)
- **Sync**: Auto-sync daemon doubles interval after 3 consecutive failures (max 1 hour)
- **DB**: Migrations 0007 (passwordChangedAt), 0008 (passwordResetTokens)

## [2026.317.0] - 2026-03-17

### Added
- **Sessions**: Sort order toggle (Newest/Oldest First) in session detail and shared viewer

### Fixed
- **Sync**: Force IPv4 (`family: 4`) to prevent Node.js Happy Eyeballs IPv6 timeout on Cloudflare

## [2026.2.18.0] - 2026-02-18

### Added
- Initial public release
- CLI prompt capture for Claude Code, Codex, Gemini CLI, OpenCode
- Local SQLite storage with FTS5 indexing
- Server sync with deduplication
- Web dashboard with analytics, search, templates, sharing
- Auto-sync daemon

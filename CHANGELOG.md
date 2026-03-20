# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

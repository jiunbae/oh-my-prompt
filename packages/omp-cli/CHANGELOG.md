# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

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

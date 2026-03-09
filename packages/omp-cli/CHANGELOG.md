# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

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

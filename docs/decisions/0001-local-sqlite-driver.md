# ADR-0001: Local SQLite driver and native WAL roadmap

- Status: Accepted, with a native-driver follow-up
- Date: 2026-08-10

## Context

The original CLI used `better-sqlite3`, WAL, and FTS5. Commit
[`2370f6d`](https://github.com/jiunbae/oh-my-prompt/commit/2370f6dfa7aaf4ed7d1e865f74142e44bf74d12d)
replaced it with `sql.js` on 2026-03-20. The commit records the reason: global
installation had to work on Node.js 20+ without a matching native binary,
`node-gyp`, Python, Xcode Command Line Tools, or a C/C++ toolchain.

That portability decision has a material runtime cost. `sql.js` loads the whole
database into memory and serialises the whole file to persist a change. On the
current 326 MiB local database, even a one-row logical update therefore writes
roughly 326 MiB. PR #28 reduced write amplification by making each captured turn
one transaction and by eliminating no-op writes, but it cannot make `sql.js`
perform page-level persistence.

The repository did not previously contain an ADR for this trade-off. Some older
documents still prescribed WAL or claimed the current CLI used
`better-sqlite3`, so the intended architecture and the shipped implementation
had diverged.

## Re-evaluation

- The current `better-sqlite3` documentation says prebuilt binaries are
  available for major supported platforms, and recommends WAL. Its 12.10.0
  release removed Node.js 20 prebuilds because Node 20 is end-of-life. The CLI
  still declares Node.js `>=20`, so a mandatory switch would recreate the
  build-tool installation failure for supported users.
- `node:sqlite` requires Node.js 22.5 or later. It became a release candidate in
  Node.js 24.15, while this CLI still supports Node 20 and Node 22 installations
  where the module is absent or experimental.
- Both native options support real file-backed transactions and WAL, which
  removes full-file serialisation and restores FTS5. The existing SQLite file
  format is reusable, but driver selection, legacy FTS handling, locking,
  backup/rollback, and cross-version installation need their own test matrix.

Official references:

- [`better-sqlite3` installation and WAL guidance](https://github.com/WiseLibs/better-sqlite3#installation)
- [`better-sqlite3` 12.10.0 release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.10.0)
- [Node.js `node:sqlite` documentation](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

## Decision

1. Keep `sql.js` as the mandatory baseline in this change; do not reintroduce a
   hard native dependency while Node.js 20 remains in `engines`.
2. Reduce its cost immediately through event-driven sync and one persistence
   transaction per accepted sync page.
3. Implement native SQLite as a separate, benchmarked driver change. The
   preferred design is native-first with an explicit `sql.js` fallback until
   the minimum Node version can move to a release where `node:sqlite` is stable.
4. Do not silently switch a user's database driver. The follow-up must include
   backup, integrity check, rollback, and an observable driver field in
   `omp status` / `omp doctor`.

## Native-driver acceptance criteria

- Installation matrix: Node 20, 22, and 24 on Linux x64/arm64 and macOS
  x64/arm64, including a machine without compiler tools.
- Existing sql.js-created databases open without data loss; schema v11,
  integrity, foreign keys, late-response sync, and search all pass.
- Concurrent hook captures and sync use WAL plus a bounded busy timeout without
  last-writer-wins loss.
- A one-row capture writes SQLite pages/WAL frames rather than a full database
  image, measured on the same real-data benchmark used by PR #28.
- If native initialisation fails, fallback is explicit and diagnostic rather
  than silently changing durability or search behaviour.

## Consequences

The current release remains installation-portable and the event-driven daemon
substantially reduces unnecessary reads and writes. Full-file persistence still
exists for actual sql.js mutations; it is a known architectural limit, not a
resolved property. Native WAL migration remains the durable fix and must be
delivered as a separately reversible change.

# ADR-0001: Native-first local SQLite with a portable fallback

- Status: Accepted and implemented in CLI 2026.810.3
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
- Both native options support real file-backed transactions, WAL, and FTS5.
  The portable on-disk schema deliberately remains standalone FTS4 so the same
  file can still be opened by the `sql.js` fallback. The existing SQLite file
  format is reusable, but driver selection, legacy FTS handling, locking,
  backup/rollback, and cross-version installation need their own test matrix.

Official references:

- [`better-sqlite3` installation and WAL guidance](https://github.com/WiseLibs/better-sqlite3#installation)
- [`better-sqlite3` 12.10.0 release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.10.0)
- [Node.js `node:sqlite` documentation](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

## Decision

1. Install `better-sqlite3` 12.9.0 as an exact optional dependency and select it
   first when its native binding can be constructed. Version 12.9.0 retains a
   Node.js 20 prebuild; 12.10.0 deliberately removed Node.js 20 prebuilds.
2. Keep `sql.js` as the automatic portability fallback when the optional native
   addon cannot be installed or loaded. `OMP_SQLITE_DRIVER=sql.js` can force it
   for diagnosis, and `OMP_SQLITE_DRIVER=native` fails explicitly if unavailable.
3. Before the first writable native open of an existing database, create
   `omp.db.pre-native.bak` (using a copy-on-write clone where supported), run
   `PRAGMA quick_check`, and write `omp.db.native-driver` only after validation.
4. Use WAL with a 15-second busy timeout for native access. Keep the existing
   transaction-facing adapter so ingest, sync, replay, and backfill retain their
   atomicity and bounded-batch behavior.
5. Expose the selected driver in `omp status` and `omp doctor`. Continue running
   auto-sync in a short-lived worker so even the sql.js fallback cannot inflate
   the resident watcher.

## Native-driver verification

- Linux x64 on Node.js 24.6 loaded the published 12.9.0 prebuild without a local
  compile, and CLI CI runs on Node.js 22. The optional dependency preserves
  installation on Node.js 20 or any platform where no compatible binary exists;
  those environments select the tested sql.js fallback.
- An existing schema-v11 sql.js database with 20,035 prompts opened through the
  native driver, passed `quick_check`, and remained queryable after a capture.
- Adapter tests cover WAL selection, concurrent handles without last-writer-wins
  loss, sql.js durability, batched transactions, fallback selection, ingest, and
  sync checkpoint persistence.
- On a 342,794,240-byte real-data clone, one unique capture completed in 9.9 ms
  and accounted for 520,192 bytes of process writes. This is 99.85% less than a
  sql.js full-image persistence of the same database.
- The selected driver and fallback state are observable in both status and
  doctor JSON output. Explicit native selection fails with
  `OMP_NATIVE_SQLITE_UNAVAILABLE` rather than changing engines.

## Consequences

Compatible installations get native WAL page-level persistence without making a
native addon mandatory for every supported platform. The one-time transition
adds a backup file roughly the size of the database when the filesystem cannot
clone it copy-on-write. The `sql.js` fallback still has full-file persistence,
but it is now explicit in diagnostics and its memory is confined to short-lived
workers rather than the resident watcher. The backup is intentionally retained
for rollback and is never deleted automatically.

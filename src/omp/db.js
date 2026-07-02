const path = require("path");
const crypto = require("crypto");
const { openDatabase } = require("./db-driver");
const { ensureDir } = require("./paths");

const MIGRATIONS = [
  {
    version: 1,
    run: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompts (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,

          source TEXT NOT NULL,
          session_id TEXT,

          role TEXT NOT NULL,
          prompt_text TEXT NOT NULL,
          response_text TEXT,

          prompt_length INTEGER NOT NULL,
          response_length INTEGER,

          project TEXT,
          cwd TEXT,

          model TEXT,
          cli_name TEXT NOT NULL,
          cli_version TEXT,
          hook_version TEXT,

          token_estimate INTEGER,
          token_estimate_response INTEGER,
          word_count INTEGER,
          word_count_response INTEGER,

          capture_response INTEGER NOT NULL DEFAULT 1,
          content_hash TEXT,

          extra_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at);
        CREATE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source);
        CREATE INDEX IF NOT EXISTS idx_prompts_session_id ON prompts(session_id);
        CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project);

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT
        );

        CREATE TABLE IF NOT EXISTS prompt_tags (
          prompt_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (prompt_id, tag_id),
          FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS prompt_reviews (
          prompt_id TEXT PRIMARY KEY,
          score INTEGER NOT NULL,
          signals_json TEXT NOT NULL,
          suggestions_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sync_log (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          status TEXT NOT NULL,
          files_uploaded INTEGER DEFAULT 0,
          records_uploaded INTEGER DEFAULT 0,
          error_message TEXT
        );
      `);

      // FTS setup: try fts5, fall back to fts4
      createFts(db);
    },
  },
  {
    version: 2,
    run: (db) => {
      addColumnIfMissing(db, "sync_log", "device_id", "TEXT");
      addColumnIfMissing(db, "sync_log", "user_token", "TEXT");
      addColumnIfMissing(db, "sync_log", "storage_type", "TEXT");
      addColumnIfMissing(db, "sync_log", "checkpoint", "TEXT");

      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (
          device_id TEXT PRIMARY KEY,
          last_synced_at TEXT,
          updated_at TEXT
        );
      `);
    },
  },
  {
    version: 3,
    run: (db) => {
      addColumnIfMissing(db, "prompts", "event_id", "TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_event_id ON prompts(event_id)");
      addColumnIfMissing(db, "sync_state", "last_synced_id", "TEXT");
    },
  },
  {
    version: 4,
    run: (db) => {
      // sql.js FTS4 content-table mode is broken: the 'delete' command always
      // fails with "SQL logic error", making UPDATE/DELETE triggers unusable.
      // Remove content-table FTS and triggers entirely. Search falls back to
      // LIKE queries which work reliably with sql.js.
      // Best-effort teardown. A legacy FTS5 prompts_fts can't be dropped by
      // sql.js (no fts5 module); assertNoLegacyFts5() in openDb already fails
      // fast for that case, so swallowing here only covers benign races.
      const tryExec = (sql) => {
        try {
          db.exec(sql);
        } catch {}
      };
      tryExec("DROP TRIGGER IF EXISTS prompts_ai");
      tryExec("DROP TRIGGER IF EXISTS prompts_ad");
      tryExec("DROP TRIGGER IF EXISTS prompts_au");

      const hasFts = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
        .get();
      if (hasFts) {
        tryExec("DROP TABLE IF EXISTS prompts_fts");
      }
    },
  },
  {
    version: 5,
    run: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_invocations (
          id TEXT PRIMARY KEY,
          prompt_id TEXT,
          session_id TEXT NOT NULL,
          sequence INTEGER NOT NULL DEFAULT 0,
          source TEXT,
          tool_name TEXT NOT NULL,
          tool_use_id TEXT NOT NULL,
          input_json TEXT,
          program TEXT,
          cwd TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_invocations_dedup
          ON tool_invocations(session_id, tool_use_id);
        CREATE INDEX IF NOT EXISTS idx_tool_invocations_prompt
          ON tool_invocations(prompt_id);
        CREATE INDEX IF NOT EXISTS idx_tool_invocations_session
          ON tool_invocations(session_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_tool_invocations_tool
          ON tool_invocations(tool_name);
        CREATE INDEX IF NOT EXISTS idx_tool_invocations_program
          ON tool_invocations(program);
      `);
    },
  },
  {
    version: 6,
    run: (db) => {
      // Composite index covers ingest dedup hot path:
      //   WHERE session_id = ? AND role = ? AND content_hash = ?
      // and the assistant→user matching path. Cuts per-record ingest cost
      // during backfill from O(rows-in-session) to O(log N).
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_prompts_dedup ON prompts(session_id, role, content_hash)"
      );
    },
  },
  {
    version: 7,
    run: (db) => {
      // Standalone FTS4 (no content-table, no triggers — both broken in sql.js).
      // Maintained explicitly via insertPrompt / updatePromptWithResponse hooks.
      // unicode61 splits on Unicode word boundaries (better than `simple` for
      // mixed-language content); fall back to default tokenizer if unavailable.
      let created = false;
      for (const tok of ["unicode61", "simple"]) {
        try {
          db.exec(
            `CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts4(prompt_text, response_text, tokenize=${tok})`
          );
          created = true;
          break;
        } catch {}
      }
      if (!created) return;

      const rows = db
        .prepare("SELECT rowid, prompt_text, response_text FROM prompts")
        .all();
      const insert = db.prepare(
        "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (?, ?, ?)"
      );
      for (const row of rows) {
        insert.run(row.rowid, row.prompt_text || "", row.response_text || "");
      }
    },
  },
  {
    version: 8,
    run: (db) => {
      // Per-turn discriminator. Without it, two identical prompts in the same
      // session (e.g. "continue", "y") collapse to one row on the content-hash
      // dedup path, silently dropping the second turn (and its distinct
      // response). Producers that know turn ordering (backfill, watch) set it;
      // when null, dedup keeps its original cross-source behaviour.
      addColumnIfMissing(db, "prompts", "turn_index", "INTEGER");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_prompts_dedup_turn ON prompts(session_id, role, content_hash, turn_index)"
      );
    },
  },
];

/**
 * FTS setup is intentionally skipped for sql.js.
 * sql.js FTS4 content-table mode has a broken 'delete' command that causes
 * "SQL logic error" on every UPDATE/DELETE, making triggers unusable.
 * Search falls back to LIKE queries which work reliably.
 */
function createFts(_db) {
  // No-op: FTS disabled for sql.js compatibility.
  // Migration v4 drops any existing FTS tables and triggers.
}

/**
 * Older versions created prompts_fts as an FTS5 virtual table. The current
 * engine is sql.js, which ships FTS3/FTS4 only — no FTS5 module. Any
 * operation that touches an FTS5 vtable (including the v4 cleanup migration's
 * DROP TABLE) fails with a cryptic "no such module: fts5" and aborts openDb.
 * Reading sqlite_master does NOT load the vtable module, so we can detect
 * this cheaply and fail fast with an actionable message instead.
 */
function assertNoLegacyFts5(db, dbPath) {
  let row;
  try {
    row = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'prompts_fts'")
      .get();
  } catch {
    return; // sqlite_master unreadable here is handled elsewhere
  }
  if (row && typeof row.sql === "string" && /fts5/i.test(row.sql)) {
    throw new Error(
      `This database was created by an older oh-my-prompt that used SQLite FTS5, ` +
        `which the current engine (sql.js) cannot open. Back up and remove ` +
        `"${dbPath}", then run \`omp backfill\` to rebuild it from your transcripts.`
    );
  }
}

async function openDb(dbPath) {
  ensureDir(path.dirname(dbPath));
  const db = await openDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  assertNoLegacyFts5(db, dbPath);
  migrate(db);
  return db;
}

function getCurrentVersion(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  if (!row) return 0;
  const versionRow = db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get();
  return versionRow ? versionRow.version : 0;
}

function migrate(db) {
  const current = getCurrentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length === 0) return;

  db.transaction(() => {
    for (const migration of pending) {
      if (typeof migration.run === "function") {
        migration.run(db);
      } else if (migration.sql) {
        db.exec(migration.sql);
      }
      // Insert version after migration runs (schema_version table now exists)
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
    }
  })();
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

module.exports = {
  openDb,
  nowIso,
  hashContent,
  getCurrentVersion,
};

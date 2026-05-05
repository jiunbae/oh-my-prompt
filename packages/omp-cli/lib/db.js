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
];

/**
 * Create FTS virtual table and sync triggers.
 * Tries fts5 first; falls back to fts4 if the module is unavailable
 * (the default sql.js WASM build ships fts4 but not fts5).
 */
function createFts(db) {
  // Check if prompts_fts already exists
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
    .get();

  if (existing) {
    // Check if existing FTS table uses fts5 (incompatible with sql.js default build)
    const sqlRow = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
      .get();
    if (sqlRow && sqlRow.sql && /fts5/i.test(sqlRow.sql)) {
      // sql.js cannot DROP fts5 virtual tables — skip FTS entirely
      // Search will fall back to LIKE queries
      return;
    }
    return;
  }

  const fts5Sql = `
    CREATE VIRTUAL TABLE prompts_fts USING fts5(
      prompt_text,
      response_text,
      project,
      content='prompts',
      content_rowid='rowid'
    );
  `;

  const fts4Sql = `
    CREATE VIRTUAL TABLE prompts_fts USING fts4(
      prompt_text,
      response_text,
      project,
      content='prompts'
    );
  `;

  try {
    db.exec(fts5Sql);
  } catch {
    db.exec(fts4Sql);
  }

  // Triggers work the same for both fts4 and fts5 content tables
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
      INSERT INTO prompts_fts(rowid, prompt_text, response_text, project)
      VALUES (new.rowid, new.prompt_text, new.response_text, new.project);
    END;

    CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
      INSERT INTO prompts_fts(prompts_fts, rowid, prompt_text, response_text, project)
      VALUES('delete', old.rowid, old.prompt_text, old.response_text, old.project);
    END;

    CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON prompts BEGIN
      INSERT INTO prompts_fts(prompts_fts, rowid, prompt_text, response_text, project)
      VALUES('delete', old.rowid, old.prompt_text, old.response_text, old.project);
      INSERT INTO prompts_fts(rowid, prompt_text, response_text, project)
      VALUES (new.rowid, new.prompt_text, new.response_text, new.project);
    END;
  `);
}

async function openDb(dbPath) {
  ensureDir(path.dirname(dbPath));
  const db = await openDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
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

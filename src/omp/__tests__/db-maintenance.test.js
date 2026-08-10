const fs = require("fs");
const os = require("os");
const path = require("path");
const { openDb, getCurrentVersion, LATEST_MIGRATION_VERSION } = require("../db");
const { openDatabase } = require("../db-driver");
const {
  deletePromptById,
  deleteSession,
  flushLocalDatabase,
  repairFtsIndex,
} = require("../db-maintenance");
const { getFtsHealth, insertFtsRow } = require("../fts");

function makeDbPath(prefix = "omp-maintenance-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(root, "omp.db");
}

function insertPrompt(db, { id, sessionId = "session-1", text = id }) {
  const now = "2026-08-10T00:00:00.000Z";
  db.prepare(
    `INSERT INTO prompts (
       id, event_id, created_at, updated_at, source, session_id, role,
       prompt_text, prompt_length, cli_name, capture_response
     ) VALUES (?, ?, ?, ?, 'test', ?, 'user', ?, ?, 'test', 1)`
  ).run(id, `event-${id}`, now, now, sessionId, text, text.length);
  const row = db.prepare("SELECT rowid FROM prompts WHERE id = ?").get(id);
  db.prepare(
    "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (?, ?, '')"
  ).run(row.rowid, text);
  return row.rowid;
}

describe("database maintenance", () => {
  it("deletes single prompts and sessions from the base table and FTS atomically", async () => {
    const db = await openDb(makeDbPath());
    insertPrompt(db, { id: "one", sessionId: "a" });
    insertPrompt(db, { id: "two", sessionId: "b" });
    insertPrompt(db, { id: "three", sessionId: "b" });

    expect(deletePromptById(db, "one")).toEqual({ deleted: 1 });
    expect(deleteSession(db, "b")).toMatchObject({ deleted: 2, ftsDeleted: 2 });
    expect(db.prepare("SELECT COUNT(*) count FROM prompts").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM prompts_fts").get().count).toBe(0);
    db.close();
  });

  it("flushes prompt, FTS, and sync state in one operation", async () => {
    const db = await openDb(makeDbPath());
    insertPrompt(db, { id: "flush-me" });
    db.prepare(
      `INSERT INTO sync_state (device_id, last_synced_at, updated_at)
       VALUES ('device', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z')`
    ).run();

    expect(flushLocalDatabase(db)).toEqual({ promptsDeleted: 1, ftsDeleted: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM prompts").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM prompts_fts").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM sync_state").get().count).toBe(0);
    db.close();
  });

  it("repairs missing, orphaned, and stale FTS rows", async () => {
    const db = await openDb(makeDbPath());
    const rowid = insertPrompt(db, { id: "repair-me", text: "repair canary" });
    const staleRowid = insertPrompt(db, { id: "stale", text: "current text" });
    db.prepare("DELETE FROM prompts_fts WHERE rowid = ?").run(rowid);
    db.prepare("UPDATE prompts_fts SET prompt_text = 'old text' WHERE rowid = ?").run(staleRowid);
    db.prepare(
      "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (999999, 'orphan', '')"
    ).run();

    expect(getFtsHealth(db)).toMatchObject({
      missing: 1,
      orphaned: 1,
      stale: 1,
      inSync: false,
    });
    const result = repairFtsIndex(db);
    expect(result).toMatchObject({
      inserted: 1,
      updated: 1,
      deleted: 1,
      missing: 0,
      orphaned: 0,
      stale: 0,
      inSync: true,
    });
    expect(
      db.prepare("SELECT prompt_text FROM prompts_fts WHERE rowid = ?").get(rowid)
    ).toEqual({ prompt_text: "repair canary" });
    expect(
      db.prepare("SELECT prompt_text FROM prompts_fts WHERE rowid = ?").get(staleRowid)
    ).toEqual({ prompt_text: "current text" });
    db.close();
  });

  it("migration 12 repairs FTS drift and drops the superseded dedup index", async () => {
    const dbPath = makeDbPath("omp-migration-12-");
    let db = await openDb(dbPath);
    const rowid = insertPrompt(db, { id: "migration-repair" });
    db.prepare("DELETE FROM prompts_fts WHERE rowid = ?").run(rowid);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_prompts_dedup ON prompts(session_id, role, content_hash)"
    );
    db.prepare("DELETE FROM schema_version WHERE version >= 12").run();
    db.close();

    db = await openDb(dbPath);
    expect(getCurrentVersion(db)).toBe(LATEST_MIGRATION_VERSION);
    expect(getFtsHealth(db)).toMatchObject({ missing: 0, orphaned: 0, inSync: true });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_prompts_dedup'").get()
    ).toBeUndefined();
    db.close();
  });

  it("repairs standalone FTS through the sql.js compatibility wrapper", async () => {
    const db = await openDatabase(null, { driver: "sql.js" });
    db.exec("CREATE TABLE prompts (id TEXT PRIMARY KEY, prompt_text TEXT, response_text TEXT)");
    db.exec("CREATE VIRTUAL TABLE prompts_fts USING fts4(prompt_text, response_text)");
    db.prepare("INSERT INTO prompts (id, prompt_text) VALUES ('one', 'portable')").run();
    db.prepare(
      "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (42, 'orphan', '')"
    ).run();

    expect(repairFtsIndex(db)).toMatchObject({ inserted: 1, deleted: 1, inSync: true });
    db.close();
  });

  it("only suppresses the expected missing-FTS case", async () => {
    const db = await openDatabase(null, { driver: "sql.js" });
    db.exec("CREATE TABLE prompts (id TEXT PRIMARY KEY, prompt_text TEXT, response_text TEXT)");
    expect(insertFtsRow(db, 1, "portable", "")).toBe(false);

    db.exec("CREATE VIRTUAL TABLE prompts_fts USING fts4(prompt_text, response_text)");
    expect(insertFtsRow(db, 1, "portable", "")).toBe(true);
    expect(() => insertFtsRow(db, 1, "duplicate", "")).toThrow();
    db.close();
  });
});

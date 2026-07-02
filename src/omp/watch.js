const fs = require("fs");
const path = require("path");
const os = require("os");
const { openDb } = require("./db");
const { ingestPayload } = require("./ingest");
const { getConfigDir } = require("./paths");
const { parseTranscript } = require("./transcript-parser");

const PID_FILE = path.join(getConfigDir(), "watch.pid");
const DEBOUNCE_MS = 500;

// -----------------------------------------------------------------------------
// Watch targets
//
// Real Claude Code transcripts live at ~/.claude/projects/**/*.jsonl (JSONL, one
// entry per line — NOT ~/.claude/transcripts with a { messages: [...] } blob,
// which never existed). We reuse the shared transcript-parser (the same code
// path as `omp backfill --claude-only`) so parsing stays consistent.
//
// Codex / Gemini / OpenCode use bespoke per-session rollout formats that the
// Claude transcript-parser cannot read, and they are already captured live via
// their notify/plugin hooks. Watching them here would require re-implementing
// each format's turn extraction — out of scope for a safe fix — so watch is
// intentionally Claude-only. Use `omp hooks install` + auto-sync for the others.
// -----------------------------------------------------------------------------
function getWatchTargets() {
  const home = os.homedir();
  const targets = [];

  const claudeProjects = path.join(home, ".claude", "projects");
  if (fs.existsSync(claudeProjects)) {
    targets.push({ dir: claudeProjects, source: "claude" });
  }

  return targets;
}

function ensureWatchedFilesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      processed_at TEXT NOT NULL
    )
  `);
}

function hashFile(p) {
  try {
    const stat = fs.statSync(p);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "";
  }
}

function isAlreadyProcessed(db, filePath, fileHash) {
  const row = db
    .prepare("SELECT hash FROM watched_files WHERE path = ?")
    .get(filePath);
  return row && row.hash === fileHash;
}

function markProcessed(db, filePath, fileHash) {
  db.prepare(
    "INSERT OR REPLACE INTO watched_files (path, hash, processed_at) VALUES (?, ?, ?)"
  ).run(filePath, fileHash, new Date().toISOString());
}

// Turn a Claude transcript .jsonl file into ingest payloads. session_id is the
// file's basename (Claude names each session file with its UUID), which keeps
// the derived event_id stable across re-scans as the file grows.
function transcriptPayloads(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = content.split("\n").filter(Boolean);
  const turns = parseTranscript(lines);
  const sessionId = path.basename(filePath, ".jsonl");

  return turns.map((turn, index) => ({
    timestamp: turn.timestamp || undefined,
    source: "claude-code",
    cli_name: "claude",
    session_id: sessionId,
    role: "user",
    text: turn.userText,
    response_text: turn.responseText || null,
    capture_response: true,
    cwd: turn.cwd || null,
    project: turn.cwd ? path.basename(turn.cwd) : null,
    // turn_index disambiguates repeated identical prompts (e.g. "continue")
    // so the ingest content-hash dedup keeps each distinct turn.
    turn_index: index,
    event_id: `claude-watch:${sessionId}:${index}`,
  }));
}

async function processFile(db, config, filePath) {
  const hash = hashFile(filePath);
  if (!hash || isAlreadyProcessed(db, filePath, hash)) {
    return 0;
  }

  const payloads = transcriptPayloads(filePath);
  let count = 0;
  for (const payload of payloads) {
    if (!payload.text && !payload.response_text) continue;
    try {
      // Reuse the open watcher db handle so we don't reopen/save the whole
      // sql.js file per turn, and so ingest applies the same config (redaction,
      // capture settings) as the hook path.
      const result = await ingestPayload(payload, config, { db });
      if (result.ok) count++;
    } catch {
      // skip individual failures
    }
  }

  // Always record the hash so an unchanged file short-circuits next time, even
  // when it produced no new rows (e.g. all turns already ingested).
  markProcessed(db, filePath, hash);
  return count;
}

function collectJsonlFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { recursive: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      if (fs.statSync(fullPath).isFile() && fullPath.endsWith(".jsonl")) {
        out.push(fullPath);
      }
    } catch {
      // skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let watchers = [];
let dbRef = null;

async function startWatch(config) {
  if (watchers.length > 0) {
    return { started: false, error: "Already watching", dirs: [] };
  }

  const targets = getWatchTargets();
  if (targets.length === 0) {
    return { started: false, error: "No Claude transcript directory found (~/.claude/projects)", dirs: [] };
  }

  const db = await openDb(config.storage.sqlite.path);
  dbRef = db;
  ensureWatchedFilesTable(db);

  // Initial scan: process existing files.
  let initialCount = 0;
  for (const { dir } of targets) {
    for (const fullPath of collectJsonlFiles(dir)) {
      initialCount += await processFile(db, config, fullPath);
    }
  }

  // Set up watchers. fs.watch callbacks are synchronous, so we kick the async
  // processing off without awaiting and swallow errors (best-effort tailing).
  for (const { dir } of targets) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;
        const fullPath = path.join(dir, filename);
        setTimeout(() => {
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              processFile(db, config, fullPath).catch(() => {});
            }
          } catch {
            // skip
          }
        }, DEBOUNCE_MS);
      });
      watchers.push(watcher);
    } catch {
      // skip unwatchable dirs
    }
  }

  try {
    fs.writeFileSync(PID_FILE, process.pid.toString(), "utf8");
  } catch {
    // ignore
  }

  return {
    started: true,
    dirs: targets.map((t) => t.dir),
    initialCount,
  };
}

function stopWatch() {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // ignore
    }
  }
  watchers = [];

  if (dbRef) {
    try {
      dbRef.close();
    } catch {
      // ignore
    }
    dbRef = null;
  }

  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // ignore
  }

  return { stopped: true };
}

function isWatching() {
  return watchers.length > 0;
}

async function getStatus(config) {
  const targets = getWatchTargets();
  let processedCount = 0;

  try {
    const db = await openDb(config.storage.sqlite.path);
    ensureWatchedFilesTable(db);
    const row = db.prepare("SELECT COUNT(*) as count FROM watched_files").get();
    processedCount = row?.count || 0;
    db.close();
  } catch {
    // ignore
  }

  return {
    watching: isWatching(),
    dirs: targets.map((t) => t.dir),
    processedCount,
  };
}

async function getRecentFiles(config, limit = 20) {
  try {
    const db = await openDb(config.storage.sqlite.path);
    ensureWatchedFilesTable(db);
    const rows = db
      .prepare("SELECT path, processed_at FROM watched_files ORDER BY processed_at DESC LIMIT ?")
      .all(limit);
    db.close();
    return rows;
  } catch {
    return [];
  }
}

module.exports = {
  startWatch,
  stopWatch,
  isWatching,
  getStatus,
  getRecentFiles,
};

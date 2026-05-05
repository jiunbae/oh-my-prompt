const fs = require("fs");
const path = require("path");
const { openDb } = require("./db");
const { ingestPayload } = require("./ingest");
const { getConfigDir, ensureDir } = require("./paths");

const PID_FILE = path.join(getConfigDir(), "watch.pid");
const DEBOUNCE_MS = 500;

// Watch targets: [dir, parserFn]
function getWatchTargets(config) {
  const home = require("os").homedir();
  const targets = [];

  const claudeDir = path.join(home, ".claude", "transcripts");
  if (fs.existsSync(claudeDir)) {
    targets.push({ dir: claudeDir, source: "claude" });
  }

  const codexDir = path.join(home, ".codex");
  if (fs.existsSync(codexDir)) {
    targets.push({ dir: codexDir, source: "codex" });
  }

  const geminiDir = path.join(home, ".gemini");
  if (fs.existsSync(geminiDir)) {
    targets.push({ dir: geminiDir, source: "gemini" });
  }

  const opencodeDir = path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "opencode"
  );
  if (fs.existsSync(opencodeDir)) {
    targets.push({ dir: opencodeDir, source: "opencode" });
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

function parseTranscript(filePath, source) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);

    // Claude transcript format
    if (source === "claude" && data.messages) {
      const userMessages = data.messages.filter((m) => m.role === "user");
      const assistantMessages = data.messages.filter((m) => m.role === "assistant");
      return userMessages.map((msg, i) => ({
        prompt_text: msg.content,
        response_text: assistantMessages[i]?.content || null,
        source: "claude-code",
        session_id: data.session_id || data.id,
        project: data.project_name || data.cwd,
        cwd: data.cwd,
        model: data.model,
      }));
    }

    // Generic JSON array of prompt/response pairs
    if (Array.isArray(data)) {
      return data
        .filter((item) => item.prompt_text || item.prompt)
        .map((item) => ({
          prompt_text: item.prompt_text || item.prompt,
          response_text: item.response_text || item.response || null,
          source: item.source || source,
          session_id: item.session_id || null,
          project: item.project || item.cwd,
          cwd: item.cwd || null,
          model: item.model || null,
        }));
    }

    // Single object
    if (data.prompt_text || data.prompt) {
      return [{
        prompt_text: data.prompt_text || data.prompt,
        response_text: data.response_text || data.response || null,
        source: data.source || source,
        session_id: data.session_id || null,
        project: data.project || data.cwd,
        cwd: data.cwd || null,
        model: data.model || null,
      }];
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function processFile(db, filePath, source) {
  const hash = hashFile(filePath);
  if (!hash || isAlreadyProcessed(db, filePath, hash)) {
    return 0;
  }

  const payloads = parseTranscript(filePath, source);
  let count = 0;
  for (const payload of payloads) {
    try {
      ingestPayload(payload);
      count++;
    } catch {
      // skip individual failures
    }
  }

  if (count > 0) {
    markProcessed(db, filePath, hash);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let watchers = [];
let dbRef = null;

function startWatch(config) {
  if (watchers.length > 0) {
    return { started: false, error: "Already watching", dirs: [] };
  }

  const targets = getWatchTargets(config);
  if (targets.length === 0) {
    return { started: false, error: "No transcript directories found", dirs: [] };
  }

  const db = openDb(config.storage.sqlite.path);
  dbRef = db;
  ensureWatchedFilesTable(db);

  // Initial scan: process existing files
  let initialCount = 0;
  for (const { dir, source } of targets) {
    try {
      const entries = fs.readdirSync(dir, { recursive: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          if (fs.statSync(fullPath).isFile() && fullPath.endsWith(".json")) {
            initialCount += processFile(db, fullPath, source);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  // Set up watchers
  for (const { dir, source } of targets) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith(".json")) return;
        const fullPath = path.join(dir, filename);

        // Debounce
        setTimeout(() => {
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              processFile(db, fullPath, source);
            }
          } catch {
            // skip
          }
        }, DEBOUNCE_MS);
      });
      watchers.push(watcher);
    } catch (err) {
      // skip unwatchable dirs
    }
  }

  // Write PID file
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

function getStatus(config) {
  const targets = getWatchTargets(config);
  let processedCount = 0;

  try {
    const db = openDb(config.storage.sqlite.path);
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

function getRecentFiles(config, limit = 20) {
  try {
    const db = openDb(config.storage.sqlite.path);
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

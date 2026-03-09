const fs = require("fs");
const path = require("path");
const os = require("os");
const { hashContent } = require("./db");
const { ingestPayload } = require("./ingest");

const SYSTEM_PREFIXES = [
  "<local-command-caveat>",
  "<local-command-",
  "<command-name>",
  "<task-notification>",
  "<system-reminder>",
  "This session is being continued",
  "Stop hook feedback:",
];

function stripSystemTags(text) {
  // Remove <system-reminder>...</system-reminder> blocks that hooks inject
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

function isRealUserMessage(entry) {
  if ((entry.type || entry.role) !== "user") return false;
  const content = entry.message?.content || entry.content;
  if (typeof content !== "string") return false;
  const stripped = stripSystemTags(content.trim());
  if (!stripped) return false;

  for (const prefix of SYSTEM_PREFIXES) {
    if (stripped.startsWith(prefix)) return false;
  }
  if (stripped === "[Request interrupted by user]") return false;
  // CLI header (starts with whitespace + "Claude Code" or unicode box chars)
  if (/^\s*(Claude Code|[\u2590\u259B])/.test(stripped)) return false;

  return true;
}

function extractText(content) {
  let text;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } else {
    return "";
  }
  return stripSystemTags(text);
}

function parseTranscript(lines) {
  const entries = [];
  for (const raw of lines) {
    try {
      entries.push(JSON.parse(raw));
    } catch {}
  }

  const turns = [];
  let current = null;

  for (const entry of entries) {
    if (isRealUserMessage(entry)) {
      const content = entry.message?.content || entry.content;
      const text = extractText(content);
      current = {
        userText: text,
        responseParts: [],
        cwd: entry.cwd || "",
        timestamp: entry.timestamp || null,
      };
      turns.push(current);
    } else if ((entry.type || entry.role) === "assistant" && current) {
      const content = entry.message?.content || entry.content;
      if (!content) continue;
      const text = extractText(content);
      if (text.trim()) {
        current.responseParts.push(text);
        if (entry.cwd) current.cwd = entry.cwd;
      }
    }
  }

  return turns.map((turn) => ({
    userText: turn.userText,
    responseText: turn.responseParts.length > 0 ? turn.responseParts.join("\n\n") : null,
    cwd: turn.cwd,
    timestamp: turn.timestamp,
  }));
}

function buildEventId(sessionId, userText, timestamp, turnIndex) {
  return hashContent(
    JSON.stringify({
      source: "claude-code",
      session_id: sessionId,
      role: "user",
      prompt_text: userText,
      timestamp: timestamp || "",
      turn_index: turnIndex ?? "",
    })
  );
}

function scanTranscriptPaths(customPath) {
  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new Error(`File not found: ${customPath}`);
    }
    return [customPath];
  }

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const results = [];
  const projectDirs = fs.readdirSync(projectsDir);
  for (const dir of projectDirs) {
    const dirPath = path.join(projectsDir, dir);
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      results.push(path.join(dirPath, file));
    }
  }
  return results;
}

function backfillTranscripts(config, options = {}) {
  const paths = scanTranscriptPaths(options.path);
  let totalImported = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  const fileResults = [];

  for (const filePath of paths) {
    let lines;
    try {
      lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    } catch {
      fileResults.push({ path: filePath, turns: 0, imported: 0, skipped: 0, duplicates: 0, error: "read failed" });
      continue;
    }

    const turns = parseTranscript(lines);
    const filename = path.basename(filePath, ".jsonl");
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;

    for (let turnIdx = 0; turnIdx < turns.length; turnIdx++) {
      const turn = turns[turnIdx];
      if (!turn.userText.trim()) {
        skipped++;
        continue;
      }

      const sessionId = filename;
      const eventId = buildEventId(sessionId, turn.userText, turn.timestamp, turnIdx);

      const payload = {
        timestamp: turn.timestamp || new Date().toISOString(),
        source: "claude-code",
        session_id: sessionId,
        role: "user",
        text: turn.userText,
        response_text: turn.responseText,
        cwd: turn.cwd || "",
        project: turn.cwd ? path.basename(turn.cwd) : null,
        cli_name: "claude",
        capture_response: true,
        event_id: eventId,
      };

      if (options.dryRun) {
        imported++;
        continue;
      }

      const result = ingestPayload(payload, config);
      if (result.ok) {
        if (result.deduped) {
          duplicates++;
        } else {
          imported++;
        }
      } else {
        skipped++;
      }
    }

    fileResults.push({
      path: filePath,
      turns: turns.length,
      imported,
      skipped,
      duplicates,
    });
    totalImported += imported;
    totalSkipped += skipped;
    totalDuplicates += duplicates;
  }

  return {
    files: paths.length,
    totalImported,
    totalSkipped,
    totalDuplicates,
    fileResults,
  };
}

function getCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function getCodexHistoryPath() {
  return path.join(getCodexHome(), "history.jsonl");
}

function scanCodexSessionPaths() {
  const sessionsDir = path.join(getCodexHome(), "sessions");
  if (!fs.existsSync(sessionsDir)) return [];

  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }
  walk(sessionsDir);
  return results;
}

function parseCodexSession(filePath) {
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  } catch {
    return { sessionId: null, cwd: "", turns: [] };
  }

  let sessionId = null;
  let cwd = "";
  const turns = [];
  let currentUser = null;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "session_meta" && entry.payload) {
      sessionId = entry.payload.id || null;
      cwd = entry.payload.cwd || "";
    }

    if (entry.type === "event_msg" && entry.payload) {
      const p = entry.payload;
      if (p.type === "user_message" && p.message) {
        if (currentUser) {
          turns.push(currentUser);
        }
        currentUser = {
          userText: p.message,
          responseText: null,
          timestamp: entry.timestamp || null,
        };
      } else if (p.type === "agent_message" && p.message && currentUser) {
        currentUser.responseText = p.message;
      }
    }
  }

  if (currentUser) {
    turns.push(currentUser);
  }

  return { sessionId, cwd, turns };
}

function backfillCodex(config, options = {}) {
  const sessionPaths = scanCodexSessionPaths();
  const historyPath = getCodexHistoryPath();

  // Build a map of session responses from transcript files
  const sessionResponses = new Map();
  for (const sp of sessionPaths) {
    const parsed = parseCodexSession(sp);
    if (parsed.sessionId && parsed.turns.length > 0) {
      sessionResponses.set(parsed.sessionId, parsed);
    }
  }

  // Read history.jsonl for the canonical list of user prompts
  if (!fs.existsSync(historyPath)) {
    return { entries: 0, imported: 0, skipped: 0, duplicates: 0, sessions: sessionResponses.size };
  }

  let lines;
  try {
    lines = fs.readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  } catch {
    return { entries: 0, imported: 0, skipped: 0, duplicates: 0, error: "read failed" };
  }

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  // Group history entries by session to match with transcript turns
  const sessionHistories = new Map();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }

    const text = (entry.text || "").trim();
    if (!text) {
      skipped++;
      continue;
    }

    const sid = entry.session_id || "";
    if (!sessionHistories.has(sid)) {
      sessionHistories.set(sid, []);
    }
    sessionHistories.get(sid).push(entry);
  }

  for (const [sessionId, histEntries] of sessionHistories) {
    const session = sessionResponses.get(sessionId);
    const turns = session ? session.turns : [];
    const cwd = session ? session.cwd : "";

    for (let i = 0; i < histEntries.length; i++) {
      const entry = histEntries[i];
      const text = (entry.text || "").trim();

      // Match with transcript turn by index
      const turn = turns[i] || null;
      const responseText = turn ? turn.responseText : null;

      const timestamp = entry.ts
        ? new Date(entry.ts * 1000).toISOString()
        : new Date().toISOString();

      const eventId = hashContent(
        JSON.stringify({
          source: "codex",
          session_id: sessionId,
          role: "user",
          prompt_text: text,
          response_text: "",
        })
      );

      const payload = {
        timestamp,
        source: "codex",
        session_id: sessionId,
        role: "user",
        text,
        response_text: responseText,
        cwd: cwd,
        project: cwd ? path.basename(cwd) : "",
        cli_name: "codex",
        capture_response: !!responseText,
        event_id: eventId,
      };

      if (options.dryRun) {
        imported++;
        continue;
      }

      const result = ingestPayload(payload, config);
      if (result.ok) {
        if (result.deduped) {
          duplicates++;
        } else {
          imported++;
        }
      } else {
        skipped++;
      }
    }
  }

  return {
    entries: lines.length - skipped,
    imported,
    skipped,
    duplicates,
    sessions: sessionResponses.size,
  };
}

// ── OpenCode backfill (SQLite) ──────────────────────────────────────

function getOpenCodeDbPath() {
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdg, "opencode", "opencode.db");
}

function backfillOpenCode(config, options = {}) {
  const dbPath = getOpenCodeDbPath();
  if (!fs.existsSync(dbPath)) {
    return { sessions: 0, imported: 0, skipped: 0, duplicates: 0, error: "OpenCode database not found" };
  }

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    return { sessions: 0, imported: 0, skipped: 0, duplicates: 0, error: "better-sqlite3 not available" };
  }

  const ocDb = new Database(dbPath, { readonly: true });
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  // Get all sessions with their messages
  const sessions = ocDb.prepare(
    "SELECT id, title, directory, time_created FROM session ORDER BY time_created ASC"
  ).all();

  for (const session of sessions) {
    // Get user and assistant messages for this session
    const messages = ocDb.prepare(
      `SELECT m.id, m.time_created,
              json_extract(m.data, '$.role') as role,
              json_extract(m.data, '$.model.modelID') as model
       FROM message m
       WHERE m.session_id = ?
       ORDER BY m.time_created ASC`
    ).all(session.id);

    // Pair user/assistant messages
    const turns = [];
    let currentUser = null;

    for (const msg of messages) {
      if (msg.role === "user") {
        if (currentUser) turns.push(currentUser);
        // Get text parts for this message
        const parts = ocDb.prepare(
          `SELECT json_extract(data, '$.text') as text
           FROM part
           WHERE message_id = ? AND json_extract(data, '$.type') = 'text'`
        ).all(msg.id);
        const text = parts.map((p) => p.text || "").join("\n").trim();
        currentUser = {
          messageId: msg.id,
          text,
          responseText: null,
          responseId: null,
          timestamp: msg.time_created ? new Date(msg.time_created).toISOString() : null,
          model: msg.model || null,
        };
      } else if (msg.role === "assistant" && currentUser) {
        const parts = ocDb.prepare(
          `SELECT json_extract(data, '$.text') as text
           FROM part
           WHERE message_id = ? AND json_extract(data, '$.type') = 'text'`
        ).all(msg.id);
        currentUser.responseText = parts.map((p) => p.text || "").join("\n").trim() || null;
        currentUser.responseId = msg.id;
      }
    }
    if (currentUser) turns.push(currentUser);

    for (const turn of turns) {
      if (!turn.text) {
        skipped++;
        continue;
      }

      const eventId = hashContent(
        JSON.stringify({
          source: "opencode",
          session_id: session.id,
          user_message_id: turn.messageId,
        })
      );

      const payload = {
        timestamp: turn.timestamp || new Date().toISOString(),
        source: "opencode",
        session_id: session.id,
        role: "user",
        text: turn.text,
        response_text: turn.responseText,
        cwd: session.directory || "",
        project: session.directory ? path.basename(session.directory) : "",
        cli_name: "opencode",
        model: turn.model,
        capture_response: !!turn.responseText,
        event_id: eventId,
      };

      if (options.dryRun) {
        imported++;
        continue;
      }

      const result = ingestPayload(payload, config);
      if (result.ok) {
        if (result.deduped) duplicates++;
        else imported++;
      } else {
        skipped++;
      }
    }
  }

  ocDb.close();
  return { sessions: sessions.length, imported, skipped, duplicates };
}

// ── Gemini backfill (chat JSON files) ───────────────────────────────

function getGeminiHome() {
  return process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
}

function scanGeminiChatFiles() {
  const tmpDir = path.join(getGeminiHome(), "tmp");
  if (!fs.existsSync(tmpDir)) return [];

  const results = [];
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(tmpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const chatsDir = path.join(tmpDir, entry.name, "chats");
    if (!fs.existsSync(chatsDir)) continue;

    let chatFiles;
    try {
      chatFiles = fs.readdirSync(chatsDir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const file of chatFiles) {
      results.push({
        path: path.join(chatsDir, file),
        projectHash: entry.name,
      });
    }
  }
  return results;
}

function resolveGeminiProjectDir(projectHash) {
  // Try to find project root from history dir
  const geminiHome = getGeminiHome();
  const historyDir = path.join(geminiHome, "history");
  if (!fs.existsSync(historyDir)) return "";

  try {
    const users = fs.readdirSync(historyDir, { withFileTypes: true });
    for (const user of users) {
      if (!user.isDirectory()) continue;
      const hashDir = path.join(historyDir, user.name, projectHash);
      const rootFile = path.join(hashDir, ".project_root");
      if (fs.existsSync(rootFile)) {
        return fs.readFileSync(rootFile, "utf-8").trim();
      }
    }
  } catch {}

  // Also check projects.json for mapping
  const projectsFile = path.join(geminiHome, "projects.json");
  if (fs.existsSync(projectsFile)) {
    try {
      const projects = JSON.parse(fs.readFileSync(projectsFile, "utf-8"));
      // projects.json maps dir -> name, not hash -> dir, so we can't directly resolve
      // Return empty and fall back to session data
    } catch {}
  }

  return "";
}

function extractGeminiContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    // Content can be an array of parts like [{text: "..."}, ...]
    return content
      .map((part) => (typeof part === "string" ? part : part.text || ""))
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object" && content.text) {
    return String(content.text).trim();
  }
  return "";
}

function backfillGemini(config, options = {}) {
  const chatFiles = scanGeminiChatFiles();
  if (chatFiles.length === 0) {
    return { sessions: 0, imported: 0, skipped: 0, duplicates: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  let sessionCount = 0;

  for (const { path: filePath, projectHash } of chatFiles) {
    let chat;
    try {
      chat = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      skipped++;
      continue;
    }

    if (!chat.messages || !Array.isArray(chat.messages)) continue;

    const sessionId = chat.sessionId || path.basename(filePath, ".json");
    const projectDir = resolveGeminiProjectDir(projectHash);
    sessionCount++;

    // Parse user/gemini message pairs
    const turns = [];
    let currentUser = null;

    for (const msg of chat.messages) {
      if (msg.type === "user") {
        const content = extractGeminiContent(msg.content);
        // Skip system messages
        if (!content || content === "System: Please continue." || content.startsWith("System:")) {
          continue;
        }
        if (currentUser) turns.push(currentUser);
        currentUser = {
          messageId: msg.id || null,
          text: content,
          responseText: null,
          timestamp: msg.timestamp || null,
        };
      } else if (msg.type === "gemini" && currentUser) {
        const content = extractGeminiContent(msg.content);
        if (content) {
          currentUser.responseText = content;
        }
      }
      // Skip info, error, system messages
    }
    if (currentUser) turns.push(currentUser);

    for (const turn of turns) {
      if (!turn.text) {
        skipped++;
        continue;
      }

      const eventId = hashContent(
        JSON.stringify({
          source: "gemini",
          session_id: sessionId,
          message_id: turn.messageId || "",
          prompt_text: turn.text,
        })
      );

      const payload = {
        timestamp: turn.timestamp || new Date().toISOString(),
        source: "gemini",
        session_id: sessionId,
        role: "user",
        text: turn.text,
        response_text: turn.responseText,
        cwd: projectDir,
        project: projectDir ? path.basename(projectDir) : "",
        cli_name: "gemini",
        capture_response: !!turn.responseText,
        event_id: eventId,
      };

      if (options.dryRun) {
        imported++;
        continue;
      }

      const result = ingestPayload(payload, config);
      if (result.ok) {
        if (result.deduped) duplicates++;
        else imported++;
      } else {
        skipped++;
      }
    }
  }

  return { sessions: sessionCount, imported, skipped, duplicates };
}

module.exports = {
  backfillTranscripts,
  backfillCodex,
  backfillOpenCode,
  backfillGemini,
  isRealUserMessage,
  extractText,
  parseTranscript,
  scanTranscriptPaths,
};

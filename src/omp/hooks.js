const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { ensureDir, getHooksDir } = require("./paths");
const { parseTomlValue, findTomlLine, setTomlLine, removeTomlLine } = require("./toml");

const OMP_MARKER = "# Added by Oh My Prompt";

function makeExecutable(filePath) {
  fs.chmodSync(filePath, 0o755);
}

function claudeHookScript() {
  return `#!/usr/bin/env bash
# Oh My Prompt: Claude Code UserPromptSubmit hook (prompt capture)
#
# Runs the enrich + ingest in the background and detaches so the hook returns
# in <20ms. Claude Code blocks the user's submit on the hook returning, so
# even modest latency here is felt directly.
set -euo pipefail

OMP_BIN="\${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -z "$payload" ]; then exit 0; fi

(
  exec </dev/null >/dev/null 2>&1
  # Claude Code sends: { prompt, session_id, cwd, hook_event_name, ... }
  # Map "prompt" field to "text" and add source metadata for omp ingest.
  enriched=$(node -e "
    const p = JSON.parse(process.argv[1]);
    const out = {
      ...p,
      text: p.prompt || p.text || p.prompt_text || '',
      source: p.source || 'claude-code',
      cli_name: p.cli_name || 'claude',
    };
    console.log(JSON.stringify(out));
  " "$payload" 2>/dev/null) || enriched="$payload"

  printf '%s\\n' "$enriched" | "$OMP_BIN" ingest --stdin || true
) &
disown $! 2>/dev/null || true
exit 0
`;
}

function claudeStopHookScript() {
  return `#!/usr/bin/env bash
# Oh My Prompt: Claude Code Stop hook (response capture)
#
# Performance notes:
#   * Runs the heavy work in the background so the Stop hook returns in <20ms,
#     letting Claude Code accept the user's next prompt without waiting for
#     transcript parsing or omp ingest.
#   * Parses the transcript jsonl from the tail (chunked reverse read) instead
#     of slurping the whole file. Cost per turn is bounded by the size of the
#     last turn, not the whole session. Big sessions (10MB+) used to do O(N)
#     work per turn -> O(last turn) now.
#   * Maintains a per-session checkpoint at \\$XDG_CACHE_HOME/omp/checkpoints
#     (default ~/.cache/omp/checkpoints) so repeated invocations on an
#     unchanged transcript exit immediately.
set -euo pipefail

OMP_BIN="\${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -z "$payload" ]; then exit 0; fi

# Run the actual processing in the background and detach so this hook returns
# immediately. We use a subshell ( ... ) & rather than \`bash -c\` to avoid
# nesting another layer of quoting around the embedded NODESCRIPT heredoc.
(
  exec </dev/null >/dev/null 2>&1
  response=$(OMP_PAYLOAD="$payload" node << 'NODESCRIPT'
const fs = require("fs");
const path = require("path");
const os = require("os");

const p = JSON.parse(process.env.OMP_PAYLOAD);
if (p.hook_event_name !== "Stop") process.exit(0);
const sid = p.session_id;
const tp = p.transcript_path;
if (!sid || !tp) process.exit(0);

// --- Checkpoint: skip if transcript size unchanged since last successful run.
const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
const ckptDir = path.join(cacheBase, "omp", "checkpoints");
// session_id is a UUID-ish string; sanitize defensively for filesystem.
const ckptFile = path.join(ckptDir, sid.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");

let stat;
try { stat = fs.statSync(tp); } catch { process.exit(0); }
const fileSize = stat.size;
if (fileSize === 0) process.exit(0);

let prevSize = 0;
try {
  const prev = JSON.parse(fs.readFileSync(ckptFile, "utf-8"));
  if (prev && typeof prev.size === "number") prevSize = prev.size;
} catch (_) { /* no prior checkpoint */ }

// If the transcript has not grown since last time, nothing new to capture.
if (fileSize === prevSize) process.exit(0);

// --- Tail read: pull chunks from the end until we have the last user line
// plus all subsequent assistant lines. Bounded by the size of the last turn.
const CHUNK = 64 * 1024;
const fd = fs.openSync(tp, "r");
let buf = Buffer.alloc(0);
let pos = fileSize;

function isReal(entry) {
  if ((entry.type || entry.role) !== "user") return false;
  let c = entry.message && entry.message.content;
  if (c === undefined) c = entry.content;
  if (Array.isArray(c)) {
    c = c.filter(b => b && b.type === "text").map(b => b.text).join("\\n");
    if (!c) return false;
  }
  if (typeof c !== "string") return false;
  const t = c.trim();
  if (!t) return false;
  if (t.startsWith("<local-command-")) return false;
  if (t.startsWith("<command-name>")) return false;
  if (t.startsWith("<task-notification>")) return false;
  if (t.startsWith("<system-reminder>")) return false;
  if (t.startsWith("This session is being continued")) return false;
  if (t.startsWith("Stop hook feedback:")) return false;
  if (t === "[Request interrupted by user]") return false;
  if (/^\\s*(Claude Code|[\\u2590\\u259B])/.test(t)) return false;
  return true;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(b => b && b.type === "text").map(b => b.text).join("\\n");
  }
  return "";
}

// Bound the size of tool_use.input we ship to omp ingest. A single Edit or
// WebFetch call can carry hundreds of KB; without this, JSON.stringify of the
// emitted payload can overflow the stdin pipe to the ingest process.
function clipToolInput(value) {
  const LIMIT = 32 * 1024;
  function walk(v) {
    if (typeof v === "string") {
      if (v.length <= LIMIT) return v;
      return v.slice(0, LIMIT) + "...[truncated " + (v.length - LIMIT) + " chars]";
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(value);
}

// Read backwards in CHUNK-sized blocks. After each chunk, split on newlines
// and try to parse complete lines (everything except the first/leftmost
// fragment, which may be partial until we read more). Stop as soon as the
// most-recent real user line has been seen.
let entries = []; // chronological order
let foundUser = false;
const MAX_READ = fileSize;
let totalRead = 0;

while (pos > 0 && totalRead < MAX_READ) {
  const readSize = Math.min(CHUNK, pos);
  pos -= readSize;
  const chunk = Buffer.alloc(readSize);
  fs.readSync(fd, chunk, 0, readSize, pos);
  buf = Buffer.concat([chunk, buf]);
  totalRead += readSize;

  // Split on newline. If we are not at the start of file, the first segment
  // may be partial -> keep it in buf for the next iteration.
  const text = buf.toString("utf-8");
  const lines = text.split("\\n");
  let startIdx;
  if (pos === 0) {
    startIdx = 0;
    buf = Buffer.alloc(0);
  } else {
    // Hold back the first (possibly partial) line.
    startIdx = 1;
    buf = Buffer.from(lines[0], "utf-8");
  }
  const parsed = [];
  for (let i = startIdx; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    let e;
    try { e = JSON.parse(ln); } catch (_) { continue; }
    parsed.push(e);
  }
  entries = parsed.concat(entries);

  for (let i = entries.length - 1; i >= 0; i--) {
    if (isReal(entries[i])) { foundUser = true; break; }
  }
  if (foundUser) break;
}
fs.closeSync(fd);

function writeCheckpoint() {
  try {
    fs.mkdirSync(ckptDir, { recursive: true });
    fs.writeFileSync(ckptFile, JSON.stringify({ size: fileSize }));
  } catch (_) { /* best effort */ }
}

if (!foundUser || entries.length === 0) {
  writeCheckpoint();
  process.exit(0);
}

let lastUserIdx = -1;
for (let i = entries.length - 1; i >= 0; i--) {
  if (isReal(entries[i])) { lastUserIdx = i; break; }
}
if (lastUserIdx === -1) { writeCheckpoint(); process.exit(0); }

const parts = [];
const toolList = [];
let toolSeq = 0;
let cwd = "";
for (let i = lastUserIdx + 1; i < entries.length; i++) {
  const e = entries[i];
  if ((e.type || e.role) !== "assistant") continue;
  const c = (e.message && e.message.content) || e.content;
  if (!c) continue;
  const t = extractText(c);
  if (t.trim()) parts.push(t);
  if (e.cwd) cwd = e.cwd;
  if (Array.isArray(c)) {
    for (const b of c) {
      if (b && b.type === "tool_use" && b.id && b.name) {
        toolList.push({
          tool_use_id: String(b.id),
          tool_name: String(b.name),
          input: clipToolInput(b.input || {}),
          sequence: toolSeq++,
          cwd: e.cwd || "",
        });
      }
    }
  }
}
if (parts.length === 0 && toolList.length === 0) {
  writeCheckpoint();
  process.exit(0);
}

const uc = (entries[lastUserIdx].message && entries[lastUserIdx].message.content) || entries[lastUserIdx].content;
const userText = typeof uc === "string" ? uc : "";

// Update checkpoint *before* emitting so a concurrent Stop firing for the
// same session bytes will short-circuit.
writeCheckpoint();

process.stdout.write(JSON.stringify({
  session_id: sid,
  role: "assistant",
  text: parts.join("\\n\\n"),
  user_prompt_text: userText,
  source: "claude-code",
  cli_name: "claude",
  cwd: cwd || p.cwd || "",
  project: p.project || "",
  capture_response: true,
  tools: toolList,
}));
NODESCRIPT
)
  if [ -n "$response" ]; then
    printf '%s\\n' "$response" | "$OMP_BIN" ingest --stdin || true
  fi
) &
disown $! 2>/dev/null || true
exit 0
`;
}

function codexNotifyScript() {
  return `#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const raw = process.argv[2];
if (!raw) process.exit(0);

let event;
try {
  event = JSON.parse(raw);
} catch (error) {
  process.exit(0);
}

if (!event || event.type !== "agent-turn-complete") {
  process.exit(0);
}

const inputMessages = Array.isArray(event["input-messages"])
  ? event["input-messages"].join("\\n")
  : Array.isArray(event.input_messages)
    ? event.input_messages.join("\\n")
    : String(event["input-messages"] || event.input_messages || "");

const responseText = event["last-assistant-message"] || event.last_assistant_message || "";
if (!inputMessages && !responseText) {
  process.exit(0);
}

const threadId = event["thread-id"] || event.thread_id || "";
const turnId = event["turn-id"] || event.turn_id || "";

// Mine tool calls from the Codex rollout JSONL — the notify event itself does
// not carry function_call info. Files live under ~/.codex/sessions/YYYY/MM/DD/
// and are named rollout-<ts>-<threadId>.jsonl.
function findRollout(tid) {
  if (!tid) return null;
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const root = path.join(codexHome, "sessions");
  try { if (!fs.statSync(root).isDirectory()) return null; } catch (_) { return null; }
  const suffix = "-" + tid + ".jsonl";
  let newest = null;
  let newestMtime = 0;
  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p, depth + 1); continue; }
      if (ent.isFile() && ent.name.endsWith(suffix)) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs > newestMtime) { newest = p; newestMtime = st.mtimeMs; }
        } catch (_) { /* ignore */ }
      }
    }
  }
  walk(root, 0);
  return newest;
}

function clipToolInput(value) {
  const LIMIT = 32 * 1024;
  function walk(v) {
    if (typeof v === "string") {
      if (v.length <= LIMIT) return v;
      return v.slice(0, LIMIT) + "...[truncated " + (v.length - LIMIT) + " chars]";
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(value);
}

function parseArgs(arg) {
  if (arg == null) return null;
  if (typeof arg !== "string") return arg;
  try { return JSON.parse(arg); } catch (_) { return arg; }
}

function extractCodexTools(rolloutPath) {
  if (!rolloutPath) return [];
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB safety cap on a single rollout read
  let text;
  try {
    const st = fs.statSync(rolloutPath);
    if (st.size > MAX_SIZE) {
      const fd = fs.openSync(rolloutPath, "r");
      const buf = Buffer.alloc(MAX_SIZE);
      fs.readSync(fd, buf, 0, MAX_SIZE, st.size - MAX_SIZE);
      fs.closeSync(fd);
      text = buf.toString("utf-8");
      const nl = text.indexOf("\\n");
      if (nl >= 0) text = text.slice(nl + 1); // drop probably-partial first line
    } else {
      text = fs.readFileSync(rolloutPath, "utf-8");
    }
  } catch (_) { return []; }
  const out = [];
  let seq = 0;
  for (const ln of text.split("\\n")) {
    if (!ln) continue;
    let entry;
    try { entry = JSON.parse(ln); } catch (_) { continue; }
    if (!entry || entry.type !== "response_item") continue;
    const p = entry.payload;
    if (!p || p.type !== "function_call") continue;
    const id = p.call_id || p.callID || p.id || "";
    const name = p.name || "";
    if (!id || !name) continue;
    out.push({
      tool_use_id: String(id),
      tool_name: String(name),
      input: clipToolInput(parseArgs(p.arguments)),
      sequence: seq++,
      cwd: "",
    });
  }
  return out;
}

const tools = extractCodexTools(findRollout(threadId));

const payload = {
  timestamp: new Date().toISOString(),
  event_id: turnId ? "codex:" + threadId + ":" + turnId : undefined,
  source: "codex",
  session_id: threadId,
  project: event.project || "",
  cwd: event.cwd || "",
  role: "user",
  text: inputMessages,
  response_text: responseText,
  model: event.model || "",
  cli_name: "codex",
  cli_version: event["cli-version"] || event.cli_version || "",
  hook_version: "1.0.0",
  capture_response: true,
  tools,
  meta: {
    turn_id: event["turn-id"] || event.turn_id || "",
    event_type: event.type || "",
  },
};

const ompBin = process.env.OMP_BIN || "omp";
const result = spawnSync(ompBin, ["ingest", "--stdin", "--source", "codex"], {
  input: JSON.stringify(payload),
  encoding: "utf-8",
});

if (result.error) {
  process.exit(1);
}
`;
}

function codexWrapperScript(chainPath, notifyScriptPath) {
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

// Codex may spawn notify without a login-shell PATH (launched from a GUI, for
// one), in which case a version-managed node/omp would not resolve. Pin both to
// the interpreter already running this wrapper.
const nodeBin = path.dirname(process.execPath);
process.env.PATH = nodeBin + path.delimiter + (process.env.PATH || "");
if (!process.env.OMP_BIN) process.env.OMP_BIN = path.join(nodeBin, "omp");

const raw = process.argv[2];
if (!raw) process.exit(0);

let chain = null;
try {
  chain = JSON.parse(fs.readFileSync("${chainPath}", "utf-8"));
} catch (error) {
  chain = null;
}

// The chained command is whatever \`notify\` pointed at before omp was installed.
// It is under no obligation to exit — the Codex Computer Use client, for one,
// stays resident — so it has to run detached. Waiting on it would block omp's
// own capture indefinitely.
function runDetached(cmdSpec) {
  try {
    let file;
    let args;
    if (Array.isArray(cmdSpec) && cmdSpec.length > 0) {
      file = cmdSpec[0];
      args = cmdSpec.slice(1).concat([raw]);
    } else if (typeof cmdSpec === "string" && cmdSpec.trim()) {
      // Preserve string notify commands by running via sh -lc and passing raw as $1.
      file = "sh";
      args = ["-lc", cmdSpec, "omp-codex-notify", raw];
    } else {
      return;
    }
    const child = spawn(file, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch (error) {
    // ignore
  }
}

if (chain && (Array.isArray(chain.original) || typeof chain.original === "string")) {
  runDetached(chain.original);
}

// omp's own capture stays synchronous: this process must outlive the ingest.
try {
  spawnSync(process.execPath, ["${notifyScriptPath}", raw], { stdio: "ignore" });
} catch (error) {
  // ignore
}

process.exit(0);
`;
}

function getClaudeHookPath() {
  return path.join(os.homedir(), ".claude", "hooks", "prompt-logger.sh");
}

function getClaudeStopHookPath() {
  return path.join(os.homedir(), ".claude", "hooks", "stop-capture.sh");
}

function getClaudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function ensureClaudeSettingsHook(eventName, scriptPath) {
  const settingsPath = getClaudeSettingsPath();
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch (error) {
      // Do NOT reset to {} and write it back — that would destroy the user's
      // existing settings. Abort so they can fix the malformed file first.
      throw new Error(
        `Claude settings at ${settingsPath} is not valid JSON (${error.message}); ` +
          `refusing to overwrite. Fix or remove the file, then re-run.`
      );
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[eventName]) settings.hooks[eventName] = [];

  const command = `bash ${scriptPath}`;
  const hookEntries = settings.hooks[eventName];

  // Check if our hook is already registered
  const exists = hookEntries.some((entry) => {
    if (entry.hooks) {
      return entry.hooks.some((h) => h.command && h.command.includes(scriptPath));
    }
    return entry.command && entry.command.includes(scriptPath);
  });

  if (!exists) {
    hookEntries.push({
      hooks: [
        {
          type: "command",
          command: command,
        },
      ],
    });
  }

  ensureDir(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}

function removeClaudeSettingsHook(eventName, scriptPath) {
  const settingsPath = getClaudeSettingsPath();
  if (!fs.existsSync(settingsPath)) return;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  if (!settings.hooks || !settings.hooks[eventName]) return;

  settings.hooks[eventName] = settings.hooks[eventName].filter((entry) => {
    if (entry.hooks) {
      return !entry.hooks.some((h) => h.command && h.command.includes(scriptPath));
    }
    return !(entry.command && entry.command.includes(scriptPath));
  });

  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function getCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function getCodexConfigPath() {
  return path.join(getCodexHome(), "config.toml");
}

function getCodexNotifyScriptPath() {
  return path.join(getHooksDir(), "codex", "notify.js");
}

function getCodexWrapperScriptPath() {
  return path.join(getHooksDir(), "codex", "notify-wrapper.js");
}

function getCodexChainPath() {
  return path.join(getHooksDir(), "codex", "notify-chain.json");
}

function getGeminiHome() {
  return process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
}

function getGeminiSettingsPath() {
  return path.join(getGeminiHome(), "settings.json");
}

function getGeminiHookScriptPath() {
  return path.join(getHooksDir(), "gemini", "omp-gemini-hook.sh");
}

function geminiHookScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

OMP_BIN="\${OMP_BIN:-omp}"

payload="$(cat || true)"
if [ -z "$payload" ]; then
  echo '{"decision":"allow"}'
  exit 0
fi

# Build payload via a Node heredoc so we can mine the per-session chat JSON for
# tool calls (the AfterAgent hook payload alone has no tool info).
enriched=$(OMP_PAYLOAD="$payload" GEMINI_HOME="\${GEMINI_HOME:-$HOME/.gemini}" node << 'GEMSCRIPT'
const fs = require("fs");
const path = require("path");
const os = require("os");

let p;
try { p = JSON.parse(process.env.OMP_PAYLOAD); } catch { process.exit(0); }

const sessionId = p.session_id || "";
const cwd = p.cwd || "";
const text = p.prompt || p.user_message || p.text || "";
const responseText = p.response || p.model_response || "";

// Walk \${GEMINI_HOME}/tmp/<projectHash>/chats/ for a session file whose
// internal sessionId matches. Pre-filter by filename suffix using the first
// segment of sessionId to keep the directory scan cheap.
function clipToolInput(value) {
  const LIMIT = 32 * 1024;
  function walk(v) {
    if (typeof v === "string") {
      if (v.length <= LIMIT) return v;
      return v.slice(0, LIMIT) + "...[truncated " + (v.length - LIMIT) + " chars]";
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(value);
}

function findSessionFile(sid) {
  if (!sid) return null;
  const root = path.join(process.env.GEMINI_HOME, "tmp");
  try { if (!fs.statSync(root).isDirectory()) return null; } catch { return null; }
  const shortPrefix = sid.split("-")[0] || sid.slice(0, 8);
  const candidates = [];
  let projHashes;
  try { projHashes = fs.readdirSync(root); } catch { return null; }
  for (const ph of projHashes) {
    const chatsDir = path.join(root, ph, "chats");
    let entries;
    try { entries = fs.readdirSync(chatsDir); } catch { continue; }
    for (const f of entries) {
      // Filenames look like session-2026-05-14T00-00-<shortPrefix>.json
      if (!f.startsWith("session-") || !f.endsWith(".json")) continue;
      if (shortPrefix && !f.includes(shortPrefix)) continue;
      candidates.push(path.join(chatsDir, f));
    }
  }
  // Prefer the file whose JSON sessionId matches exactly; fall back to newest mtime.
  let exact = null;
  let newest = null;
  let newestMtime = 0;
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > newestMtime) { newest = p; newestMtime = st.mtimeMs; }
      if (!exact) {
        const data = JSON.parse(fs.readFileSync(p, "utf-8"));
        if (data && data.sessionId === sid) exact = p;
      }
    } catch { /* ignore */ }
  }
  return exact || newest;
}

function extractTools(filePath) {
  if (!filePath) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return []; }
  const messages = (data && Array.isArray(data.messages)) ? data.messages : [];
  const out = [];
  let seq = 0;
  for (const m of messages) {
    if (!m || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      if (!tc || !tc.id || !tc.name) continue;
      out.push({
        tool_use_id: String(tc.id),
        tool_name: String(tc.name),
        input: clipToolInput(tc.args || {}),
        sequence: seq++,
        cwd: "",
      });
    }
  }
  return out;
}

const tools = extractTools(findSessionFile(sessionId));

const out = {
  timestamp: new Date().toISOString(),
  source: "gemini",
  session_id: sessionId,
  cwd,
  role: "user",
  text,
  response_text: responseText,
  cli_name: "gemini",
  hook_version: "1.0.0",
  capture_response: true,
  tools,
  meta: { hook_event: p.hook_event_name || "" },
};

if (!out.text && !out.response_text && tools.length === 0) process.exit(0);
process.stdout.write(JSON.stringify(out));
GEMSCRIPT
) || true

if [ -n "$enriched" ]; then
  printf '%s\\n' "$enriched" | "$OMP_BIN" ingest --stdin || true
fi

echo '{"decision":"allow"}'
exit 0
`;
}

function ensureGeminiSettingsHook(scriptPath) {
  const settingsPath = getGeminiSettingsPath();
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch (error) {
      // Do NOT reset to {} and write it back — that would destroy the user's
      // existing settings. Abort so they can fix the malformed file first.
      throw new Error(
        `Gemini settings at ${settingsPath} is not valid JSON (${error.message}); ` +
          `refusing to overwrite. Fix or remove the file, then re-run.`
      );
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.AfterAgent) settings.hooks.AfterAgent = [];

  const command = `bash ${scriptPath}`;
  const hookEntries = settings.hooks.AfterAgent;

  const exists = hookEntries.some((entry) => {
    if (entry.hooks) {
      return entry.hooks.some((h) => h.command && h.command.includes(scriptPath));
    }
    return entry.command && entry.command.includes(scriptPath);
  });

  if (!exists) {
    hookEntries.push({
      hooks: [
        {
          type: "command",
          command: command,
          name: "Oh My Prompt capture",
          timeout: 10000,
        },
      ],
    });
  }

  ensureDir(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}

function removeGeminiSettingsHook(scriptPath) {
  const settingsPath = getGeminiSettingsPath();
  if (!fs.existsSync(settingsPath)) return;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return;
  }

  if (!settings.hooks || !settings.hooks.AfterAgent) return;

  settings.hooks.AfterAgent = settings.hooks.AfterAgent.filter((entry) => {
    if (entry.hooks) {
      return !entry.hooks.some((h) => h.command && h.command.includes(scriptPath));
    }
    return !(entry.command && entry.command.includes(scriptPath));
  });

  if (settings.hooks.AfterAgent.length === 0) {
    delete settings.hooks.AfterAgent;
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function installGeminiHook() {
  const scriptPath = getGeminiHookScriptPath();
  ensureDir(path.dirname(scriptPath));

  fs.writeFileSync(scriptPath, geminiHookScript());
  makeExecutable(scriptPath);

  const settingsPath = ensureGeminiSettingsHook(scriptPath);

  return { scriptPath, settingsPath, configured: true };
}

function uninstallGeminiHook() {
  const scriptPath = getGeminiHookScriptPath();
  let removed = false;

  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
    removed = true;
  }

  removeGeminiSettingsHook(scriptPath);

  return { scriptPath, removed };
}

function getOpenCodeConfigDir() {
  if (process.env.OPENCODE_CONFIG_HOME) return process.env.OPENCODE_CONFIG_HOME;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "opencode");
}

function getOpenCodeConfigPath() {
  return path.join(getOpenCodeConfigDir(), "opencode.json");
}

function getOpenCodePluginPath() {
  return path.join(getHooksDir(), "opencode", "omp-opencode-plugin.mjs");
}

function getOpenCodePluginCandidates(scriptPath) {
  const candidates = new Set([scriptPath]);
  try {
    candidates.add(pathToFileURL(scriptPath).href);
  } catch {
    // ignore
  }
  return candidates;
}

function hasOpenCodePlugin(pluginEntries, scriptPath) {
  if (!Array.isArray(pluginEntries)) return false;
  const candidates = getOpenCodePluginCandidates(scriptPath);
  return pluginEntries.some((entry) => typeof entry === "string" && candidates.has(entry));
}

function buildNotifyLine(cmdArray) {
  // Codex config.toml expects `notify` as an array of argv tokens — the program
  // plus each argument, e.g. notify = ["node", "/path/notify.js"]. Codex spawns
  // that program with the event JSON appended as the final argument (which the
  // notify script reads from process.argv[2]). A quoted string is rejected by
  // Codex's config parser, so a string-valued notify never fires the hook.
  const arr = Array.isArray(cmdArray) ? cmdArray : [cmdArray];
  return `[${arr.map((token) => JSON.stringify(String(token))).join(", ")}]`;
}

function opencodePluginScript() {
  return `import path from "node:path";
import { spawnSync } from "node:child_process";

function normalizeResponse(response) {
  if (response && typeof response === "object" && "data" in response && response.data != null) {
    return response.data;
  }
  return response;
}

function extractText(parts, role) {
  if (!Array.isArray(parts)) return "";
  const chunks = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      if (part.synthetic) continue;
      chunks.push(part.text.trim());
      continue;
    }
    if (role === "assistant" && part.type === "tool_result") {
      if (typeof part.content === "string" && part.content.trim()) {
        chunks.push(part.content.trim());
        continue;
      }
      if (Array.isArray(part.content)) {
        const text = part.content
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && typeof item.text === "string") return item.text;
            return "";
          })
          .filter(Boolean)
          .join("\\n");
        if (text.trim()) chunks.push(text.trim());
      }
    }
  }
  return chunks.join("\\n\\n").trim();
}

// Bound the size of tool inputs (Edit/WebFetch can be huge). Mirrors the
// Claude Stop hook so server-side sizing stays consistent.
function clipToolInput(value) {
  const LIMIT = 32 * 1024;
  function walk(v) {
    if (typeof v === "string") {
      if (v.length <= LIMIT) return v;
      return v.slice(0, LIMIT) + "...[truncated " + (v.length - LIMIT) + " chars]";
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  return walk(value);
}

// OpenCode part shape (canonical): { type: "tool", callID, tool, state: { input } }.
// We tolerate alternative shapes (tool_use / tool-call / id / name / args) defensively;
// they're not currently emitted by OpenCode but cost nothing to support.
function collectToolUses(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  let seq = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const t = part.type;
    if (t !== "tool" && t !== "tool_use" && t !== "tool-call") continue;
    const id = part.callID || part.call_id || part.id || part.tool_use_id || "";
    const name = part.tool || part.name || part.toolName || "";
    if (!id || !name) continue;
    const state = part.state && typeof part.state === "object" ? part.state : null;
    const input = (state && state.input) || part.input || part.args || {};
    out.push({
      tool_use_id: String(id),
      tool_name: String(name),
      input: clipToolInput(input || {}),
      sequence: seq++,
      cwd: "",
    });
  }
  return out;
}

function findLatestTurn(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const assistantEntry = messages[i];
    const assistantInfo = assistantEntry && assistantEntry.info;
    if (!assistantInfo || assistantInfo.role !== "assistant") continue;

    const assistantText = extractText(assistantEntry.parts, "assistant");
    const hasTools = collectToolUses(assistantEntry.parts).length > 0;
    if (!assistantText && !hasTools) continue;

    for (let j = i - 1; j >= 0; j -= 1) {
      const userEntry = messages[j];
      const userInfo = userEntry && userEntry.info;
      if (!userInfo || userInfo.role !== "user") continue;

      const userText = extractText(userEntry.parts, "user");
      if (!userText) continue;
      if (assistantInfo.parentID && assistantInfo.parentID !== userInfo.id) continue;

      return { userEntry, assistantEntry, userText, assistantText };
    }
  }

  return null;
}

export default async function OhMyPromptOpenCodePlugin(ctx) {
  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.idle") return;
      const sessionID = event.properties && event.properties.sessionID;
      if (!sessionID) return;

      let messagesResp;
      try {
        messagesResp = await ctx.client.session.messages({ path: { id: sessionID } });
      } catch {
        return;
      }

      const messages = normalizeResponse(messagesResp);
      const latest = findLatestTurn(messages);
      if (!latest) return;

      const { userEntry, assistantEntry, userText, assistantText } = latest;
      const assistantInfo = assistantEntry.info || {};
      const userInfo = userEntry.info || {};

      const cwd =
        (assistantInfo.path && assistantInfo.path.cwd) ||
        (userInfo.path && userInfo.path.cwd) ||
        ctx.directory ||
        process.cwd();
      const root =
        (assistantInfo.path && assistantInfo.path.root) ||
        (userInfo.path && userInfo.path.root) ||
        cwd;

      const tools = collectToolUses(assistantEntry.parts).map((t) => ({
        ...t,
        cwd: t.cwd || cwd || "",
      }));

      const payload = {
        timestamp: new Date().toISOString(),
        event_id: \`opencode:\${sessionID}:\${userInfo.id || ""}:\${assistantInfo.id || ""}\`,
        source: "opencode",
        session_id: sessionID,
        project: path.basename(root || cwd || ""),
        cwd,
        role: "user",
        text: userText,
        response_text: assistantText,
        model:
          assistantInfo.providerID && assistantInfo.modelID
            ? \`\${assistantInfo.providerID}/\${assistantInfo.modelID}\`
            : "",
        cli_name: "opencode",
        hook_version: "1.0.0",
        capture_response: true,
        tools,
        meta: {
          event_type: event.type,
          user_message_id: userInfo.id || "",
          assistant_message_id: assistantInfo.id || "",
          agent: assistantInfo.agent || userInfo.agent || "",
          variant: assistantInfo.variant || userInfo.variant || "",
        },
      };

      const ompBin = process.env.OMP_BIN || "omp";
      spawnSync(ompBin, ["ingest", "--stdin", "--source", "opencode"], {
        input: JSON.stringify(payload),
        encoding: "utf-8",
      });
    },
  };
}
`;
}

function installClaudeHook() {
  const hookPath = getClaudeHookPath();
  const stopHookPath = getClaudeStopHookPath();
  ensureDir(path.dirname(hookPath));

  // Write prompt capture hook
  fs.writeFileSync(hookPath, claudeHookScript());
  makeExecutable(hookPath);

  // Write response capture hook (Stop event)
  fs.writeFileSync(stopHookPath, claudeStopHookScript());
  makeExecutable(stopHookPath);

  // Register both hooks in Claude settings.json
  ensureClaudeSettingsHook("UserPromptSubmit", hookPath);
  ensureClaudeSettingsHook("Stop", stopHookPath);

  return hookPath;
}

function uninstallClaudeHook() {
  const hookPath = getClaudeHookPath();
  const stopHookPath = getClaudeStopHookPath();
  let removed = null;

  if (fs.existsSync(hookPath)) {
    fs.unlinkSync(hookPath);
    removed = hookPath;
  }
  if (fs.existsSync(stopHookPath)) {
    fs.unlinkSync(stopHookPath);
  }

  // Remove from Claude settings.json
  removeClaudeSettingsHook("UserPromptSubmit", hookPath);
  removeClaudeSettingsHook("Stop", stopHookPath);

  return removed;
}

function ensureCodexNotifyConfig(scriptPath, wrapperPath, chainPath) {
  const configPath = getCodexConfigPath();
  const notifyKey = "notify";
  // Spell node as an absolute path: Codex spawns `notify` directly, so a bare
  // "node" only resolves when Codex itself inherited a shell PATH carrying it.
  const nodeBin = process.execPath;
  const notifyLine = buildNotifyLine([nodeBin, scriptPath]);
  const wrapperLine = buildNotifyLine([nodeBin, wrapperPath]);

  let content = "";
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, "utf-8");
  }

  const info = findTomlLine(content, notifyKey);
  if (!info) {
    const newContent = setTomlLine(content, notifyKey, notifyLine, OMP_MARKER);
    ensureDir(path.dirname(configPath));
    fs.writeFileSync(configPath, newContent);
    return { configPath, configured: true, conflict: false, merged: false };
  }

  if (info.line.includes(scriptPath) || info.line.includes(wrapperPath)) {
    // Already ours. Rewrite anyway when the interpreter drifted — earlier
    // installs wrote a bare "node", and re-pointing it must not re-chain the
    // line into notify-chain.json (that would nest the wrapper inside itself).
    const desiredLine = info.line.includes(wrapperPath) ? wrapperLine : notifyLine;
    if (info.value.trim() !== desiredLine) {
      const newContent = setTomlLine(content, notifyKey, desiredLine, OMP_MARKER);
      ensureDir(path.dirname(configPath));
      fs.writeFileSync(configPath, newContent);
    }
    return { configPath, configured: true, conflict: false, merged: false };
  }

  const parsed = parseTomlValue(info.value);
  const mergeable = Array.isArray(parsed) || (typeof parsed === "string" && parsed.trim());
  if (!mergeable) {
    return { configPath, configured: false, conflict: true, merged: false };
  }

  const chainPayload = {
    original: parsed,
  };
  ensureDir(path.dirname(chainPath));
  fs.writeFileSync(chainPath, JSON.stringify(chainPayload, null, 2));

  const newContent = setTomlLine(content, notifyKey, wrapperLine, OMP_MARKER);
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, newContent);

  return { configPath, configured: true, conflict: false, merged: true };
}

function restoreCodexNotifyConfig(scriptPath, wrapperPath, chainPath) {
  const configPath = getCodexConfigPath();
  if (!fs.existsSync(configPath)) {
    return { configPath, restored: false, removed: false };
  }

  let content = fs.readFileSync(configPath, "utf-8");
  const info = findTomlLine(content, "notify");
  if (!info) {
    return { configPath, restored: false, removed: false };
  }

  const isOurLine = info.line.includes(scriptPath) || info.line.includes(wrapperPath);
  if (!isOurLine) {
    return { configPath, restored: false, removed: false };
  }

  let restored = false;
  let removed = false;

  if (fs.existsSync(chainPath)) {
    try {
      const chain = JSON.parse(fs.readFileSync(chainPath, "utf-8"));
      if (chain && (Array.isArray(chain.original) || typeof chain.original === "string")) {
        const restoredLine = Array.isArray(chain.original)
          ? buildNotifyLine(chain.original)
          : JSON.stringify(chain.original);
        content = setTomlLine(content, "notify", restoredLine, "");
        restored = true;
      }
    } catch (error) {
      // ignore
    }
  }

  if (!restored) {
    content = removeTomlLine(content, "notify");
    removed = true;
  }

  fs.writeFileSync(configPath, content);
  return { configPath, restored, removed };
}

function installCodexHook() {
  const scriptPath = getCodexNotifyScriptPath();
  const wrapperPath = getCodexWrapperScriptPath();
  const chainPath = getCodexChainPath();

  ensureDir(path.dirname(scriptPath));
  fs.writeFileSync(scriptPath, codexNotifyScript());
  makeExecutable(scriptPath);

  fs.writeFileSync(wrapperPath, codexWrapperScript(chainPath, scriptPath));
  makeExecutable(wrapperPath);

  const result = ensureCodexNotifyConfig(scriptPath, wrapperPath, chainPath);
  return {
    scriptPath,
    wrapperPath,
    chainPath,
    configPath: result.configPath,
    configured: result.configured,
    conflict: result.conflict,
    merged: result.merged,
  };
}

function uninstallCodexHook() {
  const scriptPath = getCodexNotifyScriptPath();
  const wrapperPath = getCodexWrapperScriptPath();
  const chainPath = getCodexChainPath();

  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
  }
  if (fs.existsSync(wrapperPath)) {
    fs.unlinkSync(wrapperPath);
  }

  const restoration = restoreCodexNotifyConfig(scriptPath, wrapperPath, chainPath);
  if (fs.existsSync(chainPath)) {
    fs.unlinkSync(chainPath);
  }

  return {
    scriptPath,
    wrapperPath,
    configPath: restoration.configPath,
    restored: restoration.restored,
    removed: restoration.removed,
  };
}

function installOpenCodeHook() {
  const scriptPath = getOpenCodePluginPath();
  const configPath = getOpenCodeConfigPath();

  ensureDir(path.dirname(scriptPath));
  fs.writeFileSync(scriptPath, opencodePluginScript());

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (error) {
      throw new Error(`OpenCode config is not valid JSON: ${error.message}`);
    }
  }

  if (!config || typeof config !== "object") {
    throw new Error("OpenCode config has unexpected format");
  }
  if (!config.$schema) {
    config.$schema = "https://opencode.ai/config.json";
  }
  if (config.plugin === undefined) {
    config.plugin = [];
  }
  if (!Array.isArray(config.plugin)) {
    return { scriptPath, configPath, configured: false, conflict: true };
  }

  if (!hasOpenCodePlugin(config.plugin, scriptPath)) {
    config.plugin.push(scriptPath);
  }

  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  return { scriptPath, configPath, configured: true, conflict: false };
}

function uninstallOpenCodeHook() {
  const scriptPath = getOpenCodePluginPath();
  const configPath = getOpenCodeConfigPath();
  let removed = false;

  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
    removed = true;
  }

  let configUpdated = false;
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config && typeof config === "object" && Array.isArray(config.plugin)) {
        const candidates = getOpenCodePluginCandidates(scriptPath);
        const next = config.plugin.filter(
          (item) => !(typeof item === "string" && candidates.has(item))
        );
        if (next.length !== config.plugin.length) {
          config.plugin = next;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
          configUpdated = true;
        }
      }
    } catch {
      // ignore parse errors on uninstall
    }
  }

  return {
    scriptPath,
    configPath,
    removed,
    configUpdated,
  };
}

function listHookStatus() {
  const configPath = getCodexConfigPath();
  let codexConfigured = false;
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const info = findTomlLine(content, "notify");
    if (info) {
      const scriptPath = getCodexNotifyScriptPath();
      const wrapperPath = getCodexWrapperScriptPath();
      codexConfigured = info.line.includes(scriptPath) || info.line.includes(wrapperPath);
    }
  }

  const geminiScriptPath = getGeminiHookScriptPath();
  let geminiConfigured = false;
  if (fs.existsSync(geminiScriptPath)) {
    const geminiSettingsPath = getGeminiSettingsPath();
    if (fs.existsSync(geminiSettingsPath)) {
      try {
        const geminiSettings = JSON.parse(fs.readFileSync(geminiSettingsPath, "utf-8"));
        if (geminiSettings.hooks && Array.isArray(geminiSettings.hooks.AfterAgent)) {
          geminiConfigured = geminiSettings.hooks.AfterAgent.some((entry) => {
            if (entry.hooks) {
              return entry.hooks.some((h) => h.command && h.command.includes(geminiScriptPath));
            }
            return entry.command && entry.command.includes(geminiScriptPath);
          });
        }
      } catch {
        geminiConfigured = false;
      }
    }
  }

  const opencodeConfigPath = getOpenCodeConfigPath();
  const opencodeScriptPath = getOpenCodePluginPath();
  let opencodeConfigured = false;
  if (fs.existsSync(opencodeConfigPath) && fs.existsSync(opencodeScriptPath)) {
    try {
      const opencodeConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf-8"));
      if (opencodeConfig && Array.isArray(opencodeConfig.plugin)) {
        opencodeConfigured = hasOpenCodePlugin(opencodeConfig.plugin, opencodeScriptPath);
      }
    } catch {
      opencodeConfigured = false;
    }
  }

  return {
    claude_code: fs.existsSync(getClaudeHookPath()),
    claude_code_stop: fs.existsSync(getClaudeStopHookPath()),
    codex: codexConfigured,
    gemini: geminiConfigured,
    opencode: opencodeConfigured,
  };
}

module.exports = {
  installClaudeHook,
  uninstallClaudeHook,
  installCodexHook,
  uninstallCodexHook,
  installGeminiHook,
  uninstallGeminiHook,
  installOpenCodeHook,
  uninstallOpenCodeHook,
  listHookStatus,
};

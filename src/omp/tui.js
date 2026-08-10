const readline = require("readline");
const { spawn, spawnSync } = require("child_process");
const { openDb } = require("./db");
const { c } = require("./ui");
const { syncToServer } = require("./sync");
const { deletePromptById } = require("./db-maintenance");

const ESC = "\x1B";
const CLEAR = ESC + "[2J";
const HOME = ESC + "[H";
const HIDE_CURSOR = ESC + "[?25l";
const SHOW_CURSOR = ESC + "[?25h";

function clearScreen() {
  process.stdout.write(CLEAR + HOME);
}

function drawLine(text) {
  process.stdout.write(text + "\n");
}

function padEnd(str, len) {
  return String(str).slice(0, len).padEnd(len);
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function truncate(text, len) {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ");
  return t.length > len ? t.slice(0, len - 3) + "..." : t;
}

function copyToClipboard(text, dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  const run = dependencies.spawn || spawn;
  const probe = dependencies.spawnSync || spawnSync;
  const candidates =
    platform === "darwin"
      ? [["pbcopy", []]]
      : [
          ["wl-copy", []],
          ["xclip", ["-selection", "clipboard"]],
          ["xsel", ["--clipboard", "--input"]],
        ];

  for (const [command, args] of candidates) {
    if (probe("which", [command], { stdio: "ignore" }).status !== 0) continue;
    const child = run(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    // A clipboard utility can disappear between the availability probe and
    // spawn. Consume both error events so the TUI stays alive in that race.
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(text);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadPrompts(db, limit = 100) {
  try {
    return db
      .prepare(`
        SELECT p.id, p.created_at, p.prompt_text, p.response_text,
               p.project, p.source, p.session_id,
               EXISTS(SELECT 1 FROM favorite_prompts fp WHERE fp.prompt_id = p.id) as favorited
        FROM prompts p
        ORDER BY p.created_at DESC
        LIMIT ?
      `)
      .all(limit);
  } catch {
    return [];
  }
}

function searchPrompts(db, query, limit = 100) {
  try {
    const like = `%${query}%`;
    return db
      .prepare(`
        SELECT p.id, p.created_at, p.prompt_text, p.response_text,
               p.project, p.source, p.session_id,
               EXISTS(SELECT 1 FROM favorite_prompts fp WHERE fp.prompt_id = p.id) as favorited
        FROM prompts p
        WHERE (p.prompt_text LIKE ? OR p.project LIKE ? OR p.source LIKE ?)
        ORDER BY p.created_at DESC
        LIMIT ?
      `)
      .all(like, like, like, limit);
  } catch {
    return [];
  }
}

function getPromptCount(db) {
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM prompts").get();
    return row?.c || 0;
  } catch {
    return 0;
  }
}

function getLastSync(db) {
  try {
    const row = db.prepare("SELECT MAX(created_at) as ts FROM sync_log").get();
    return row?.ts || null;
  } catch {
    return null;
  }
}

function toggleFavorite(db, promptId) {
  try {
    const existing = db.prepare("SELECT 1 FROM favorite_prompts WHERE prompt_id = ?").get(promptId);
    if (existing) {
      db.prepare("DELETE FROM favorite_prompts WHERE prompt_id = ?").run(promptId);
      return false;
    } else {
      db.prepare("INSERT INTO favorite_prompts (prompt_id) VALUES (?)").run(promptId);
      return true;
    }
  } catch {
    return false;
  }
}

function deletePrompt(db, promptId) {
  try {
    return deletePromptById(db, promptId).deleted > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function drawHeader(config, db) {
  const count = getPromptCount(db);
  const lastSync = getLastSync(db);
  const syncStr = lastSync ? formatDate(lastSync) : "never";
  drawLine(`${c.bold(c.cyan("oh-my-prompt TUI"))}  ${c.dim(`${count} prompts`)}  ${c.dim(`last sync: ${syncStr}`)}`);
  drawLine(c.dim("─".repeat(80)));
}

function drawPromptList(prompts, selectedIndex, startIndex, height) {
  const visible = prompts.slice(startIndex, startIndex + height);
  for (let i = 0; i < height; i++) {
    const idx = startIndex + i;
    const p = visible[i];
    if (!p) {
      drawLine("");
      continue;
    }
    const isSelected = idx === selectedIndex;
    const prefix = isSelected ? c.cyan("▸ ") : "  ";
    const date = formatDate(p.created_at);
    const project = truncate(p.project || p.source || "—", 12);
    const text = truncate(p.prompt_text, 50);
    const star = p.favorited ? c.yellow("★ ") : "  ";
    const line = `${prefix}${star}${c.dim(padEnd(date, 18))} ${c.dim(padEnd(project, 14))} ${text}`;
    drawLine(isSelected ? c.bold(line) : line);
  }
}

function drawPromptDetail(prompt) {
  drawLine("");
  drawLine(c.bold(c.cyan("Prompt")));
  drawLine(c.dim("─".repeat(40)));
  drawLine(prompt.prompt_text || "(empty)");
  drawLine("");
  if (prompt.response_text) {
    drawLine(c.bold(c.cyan("Response")));
    drawLine(c.dim("─".repeat(40)));
    drawLine(prompt.response_text);
  }
}

function drawStatusBar(mode, searchQuery, notice = null) {
  const hints = {
    list: "j/k: navigate  Enter: view  /: search  f: favorite  d: delete  s: sync  q: quit",
    detail: "j/k: scroll  Esc: back  p: copy prompt  r: copy response  q: quit",
    search: "Type to filter  Enter: select  Esc: cancel",
  };
  const hint = notice || hints[mode] || "";
  const searchStr = searchQuery ? `  [search: ${searchQuery}]` : "";
  drawLine(c.dim("─".repeat(80)));
  drawLine(c.dim(hint + searchStr));
}

// ---------------------------------------------------------------------------
// Main TUI
// ---------------------------------------------------------------------------

async function startTui(config) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("omp tui requires an interactive terminal");
  }
  const db = await openDb(config.storage.sqlite.path);
  let prompts = loadPrompts(db);
  let filteredPrompts = prompts;
  let selectedIndex = 0;
  let scrollStart = 0;
  let mode = "list";
  let searchQuery = "";
  let detailScroll = 0;
  let pendingDeleteId = null;
  let listHeight = Math.max(1, (process.stdout.rows || 24) - 6);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.write(HIDE_CURSOR);

  function refresh() {
    clearScreen();
    drawHeader(config, db);

    if (mode === "list") {
      drawPromptList(filteredPrompts, selectedIndex, scrollStart, listHeight);
      drawStatusBar(
        "list",
        searchQuery,
        pendingDeleteId ? "Press d again to confirm permanent local deletion; any other key cancels" : null
      );
    } else if (mode === "detail") {
      const prompt = filteredPrompts[selectedIndex];
      if (prompt) {
        drawPromptDetail(prompt);
      }
      drawStatusBar("detail");
    } else if (mode === "search") {
      drawPromptList(filteredPrompts, selectedIndex, scrollStart, listHeight);
      drawStatusBar("search", searchQuery);
    }
  }

  function clampSelection() {
    if (selectedIndex < 0) selectedIndex = 0;
    if (selectedIndex >= filteredPrompts.length) selectedIndex = Math.max(0, filteredPrompts.length - 1);
    if (selectedIndex < scrollStart) scrollStart = selectedIndex;
    if (selectedIndex >= scrollStart + listHeight) scrollStart = selectedIndex - listHeight + 1;
    if (scrollStart < 0) scrollStart = 0;
  }

  function handleKey(key) {
    if (mode === "search") {
      if (key === "\x7F" || key === "\b") {
        searchQuery = searchQuery.slice(0, -1);
      } else if (key === "\x1B" || key === "\r" || key === "\n") {
        mode = "list";
        if (!searchQuery) {
          filteredPrompts = prompts;
        }
        selectedIndex = 0;
        scrollStart = 0;
        return;
      } else if (key.length === 1 && key >= " ") {
        searchQuery += key;
        filteredPrompts = searchPrompts(db, searchQuery);
        selectedIndex = 0;
        scrollStart = 0;
      }
      return;
    }

    if (mode === "detail") {
      if (key === "\x1B" || key === "q") {
        mode = "list";
        detailScroll = 0;
      } else if (key === "j" || key === "\x1B[B") {
        detailScroll++;
      } else if (key === "k" || key === "\x1B[A") {
        detailScroll = Math.max(0, detailScroll - 1);
      } else if (key === "p") {
        const p = filteredPrompts[selectedIndex];
        if (p?.prompt_text) {
          copyToClipboard(p.prompt_text);
        }
      } else if (key === "r") {
        const p = filteredPrompts[selectedIndex];
        if (p?.response_text) {
          copyToClipboard(p.response_text);
        }
      }
      return;
    }

    // list mode
    if (key !== "d") pendingDeleteId = null;
    if (key === "q") {
      cleanup();
      process.exit(0);
    } else if (key === "j" || key === "\x1B[B") {
      selectedIndex++;
      clampSelection();
    } else if (key === "k" || key === "\x1B[A") {
      selectedIndex--;
      clampSelection();
    } else if (key === "\r" || key === "\n") {
      mode = "detail";
      detailScroll = 0;
    } else if (key === "g" && selectedIndex !== 0) {
      selectedIndex = 0;
      scrollStart = 0;
    } else if (key === "G") {
      selectedIndex = filteredPrompts.length - 1;
      clampSelection();
    } else if (key === "/") {
      mode = "search";
      searchQuery = "";
      filteredPrompts = prompts;
      selectedIndex = 0;
      scrollStart = 0;
    } else if (key === "f") {
      const p = filteredPrompts[selectedIndex];
      if (p) {
        toggleFavorite(db, p.id);
        prompts = loadPrompts(db);
        filteredPrompts = searchQuery ? searchPrompts(db, searchQuery) : prompts;
      }
    } else if (key === "d") {
      const p = filteredPrompts[selectedIndex];
      if (p) {
        if (pendingDeleteId === p.id) {
          deletePrompt(db, p.id);
          pendingDeleteId = null;
          prompts = loadPrompts(db);
          filteredPrompts = searchQuery ? searchPrompts(db, searchQuery) : prompts;
          clampSelection();
        } else {
          pendingDeleteId = p.id;
        }
      }
    } else if (key === "s") {
      syncToServer(config).catch(() => {});
    }
  }

  function cleanup() {
    process.stdin.setRawMode(false);
    process.stdout.write(SHOW_CURSOR);
    rl.close();
    try { db.close(); } catch {}
  }

  process.stdin.on("keypress", (str, key) => {
    if (key && key.ctrl && key.name === "c") {
      cleanup();
      process.exit(0);
    }
    handleKey(str || "");
    refresh();
  });

  process.stdout.on("resize", () => {
    listHeight = Math.max(1, (process.stdout.rows || 24) - 6);
    clampSelection();
    refresh();
  });

  refresh();
}

module.exports = {
  startTui,
  loadPrompts,
  searchPrompts,
  getPromptCount,
  toggleFavorite,
  deletePrompt,
  copyToClipboard,
};

const readline = require("readline");
const { spawnSync } = require("child_process");
const { c } = require("./ui");
const { openDb } = require("./db");
const { syncToServer } = require("./sync");
const { getSyncStatus } = require("./sync-log");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const ANSI = {
  clear: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  inverse: "\x1b[7m",
  reset: "\x1b[0m",
};

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function visualLength(str) {
  return stripAnsi(str).length;
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------
function getTermSize() {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
function ensureTuiColumns(db) {
  try {
    const columns = db.prepare("PRAGMA table_info(prompts)").all();
    const names = new Set(columns.map((col) => col.name));
    if (!names.has("deleted_at")) {
      db.exec("ALTER TABLE prompts ADD COLUMN deleted_at TEXT");
    }
    if (!names.has("favorite")) {
      db.exec("ALTER TABLE prompts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
    }
  } catch {
    // Ignore — may be read-only or unsupported
  }
}

async function loadPromptsFromDb(db) {
  ensureTuiColumns(db);
  const rows = db
    .prepare(
      `SELECT id, created_at, source, project, cli_name, prompt_text, response_text,
              prompt_length, response_length, model, session_id, favorite
       FROM prompts
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 500`
    )
    .all();
  return rows.map((r) => ({ ...r, favorite: r.favorite ? true : false }));
}

async function getPromptStats(db) {
  ensureTuiColumns(db);
  const total = db.prepare("SELECT COUNT(*) as c FROM prompts WHERE deleted_at IS NULL").get();
  const last = db
    .prepare("SELECT created_at FROM prompts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get();
  return { total: total ? total.c : 0, lastPrompt: last ? last.created_at : null };
}

async function toggleFavorite(db, promptId, current) {
  ensureTuiColumns(db);
  db.prepare("UPDATE prompts SET favorite = ? WHERE id = ?").run(current ? 0 : 1, promptId);
}

async function softDeletePrompt(db, promptId) {
  ensureTuiColumns(db);
  db.prepare("UPDATE prompts SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), promptId);
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------
function truncate(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function wrapText(text, width) {
  if (!text) return [];
  const lines = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("");
      continue;
    }
    for (let i = 0; i < para.length; i += width) {
      lines.push(para.slice(i, i + width));
    }
  }
  return lines;
}

function copyToClipboard(text) {
  if (!text) return false;
  const platform = process.platform;
  if (platform === "darwin") {
    const result = spawnSync("pbcopy", [], { input: text, stdio: ["pipe", "ignore", "ignore"] });
    return result.status === 0;
  }
  if (platform === "linux") {
    const result = spawnSync("xclip", ["-selection", "clipboard"], {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (result.status === 0) return true;
    const result2 = spawnSync("wl-copy", [], { input: text, stdio: ["pipe", "ignore", "ignore"] });
    return result2.status === 0;
  }
  if (platform === "win32") {
    const result = spawnSync(
      "powershell",
      ["-command", "Set-Clipboard -Value '" + text.replace(/'/g, "''") + "'"],
      { stdio: ["ignore", "ignore", "ignore"] }
    );
    return result.status === 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main TUI
// ---------------------------------------------------------------------------
async function startTui(config, options = {}) {
  if (!process.stdin.isTTY) {
    console.error("TUI requires an interactive terminal.");
    process.exitCode = 1;
    return;
  }

  const db = await openDb(config.storage.sqlite.path);
  let prompts = [];
  let filtered = [];
  let stats = { total: 0, lastPrompt: null };
  let syncInfo = { lastSync: null };

  async function reloadData() {
    prompts = await loadPromptsFromDb(db);
    filtered = [...prompts];
    stats = await getPromptStats(db);
    try {
      const status = await getSyncStatus(config, 1);
      syncInfo.lastSync = status.checkpoint?.lastSyncedAt;
    } catch {
      syncInfo.lastSync = null;
    }
  }

  await reloadData();

  // State
  let mode = "list"; // 'list' | 'detail' | 'search'
  let selectedIndex = 0;
  let scrollOffset = 0;
  let detailIndex = 0;
  let detailScroll = 0;
  let searchQuery = "";
  let message = "";
  let messageTimer = null;
  let isSyncing = false;
  let quit = false;

  let termH = getTermSize().rows;
  let termW = getTermSize().cols;

  function setMessage(msg) {
    message = msg;
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message = "";
      render();
    }, 3000);
  }

  function updateFiltered() {
    const q = searchQuery.toLowerCase();
    if (!q) {
      filtered = [...prompts];
    } else {
      filtered = prompts.filter((p) => {
        const text = (p.prompt_text || "").toLowerCase();
        const resp = (p.response_text || "").toLowerCase();
        return text.includes(q) || resp.includes(q);
      });
    }
    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }
    if (scrollOffset > selectedIndex) {
      scrollOffset = selectedIndex;
    }
  }

  function visibleContentRows() {
    return termH - 3; // header (2 lines) + status bar (1 line)
  }

  function ensureScroll() {
    const vr = visibleContentRows();
    if (mode === "search") {
      // Search uses 1 line for the query input
      const resultRows = vr - 1;
      if (selectedIndex < scrollOffset) {
        scrollOffset = selectedIndex;
      } else if (selectedIndex >= scrollOffset + resultRows) {
        scrollOffset = selectedIndex - resultRows + 1;
      }
      if (scrollOffset < 0) scrollOffset = 0;
      if (scrollOffset > Math.max(0, filtered.length - resultRows)) {
        scrollOffset = Math.max(0, filtered.length - resultRows);
      }
    } else {
      if (selectedIndex < scrollOffset) {
        scrollOffset = selectedIndex;
      } else if (selectedIndex >= scrollOffset + vr) {
        scrollOffset = selectedIndex - vr + 1;
      }
      if (scrollOffset < 0) scrollOffset = 0;
      if (scrollOffset > Math.max(0, filtered.length - vr)) {
        scrollOffset = Math.max(0, filtered.length - vr);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render builders
  // ---------------------------------------------------------------------------
  function buildHeader() {
    const title = "oh-my-prompt";
    const totalStr = `${stats.total} prompts`;
    const lastStr = stats.lastPrompt ? `last: ${formatDate(stats.lastPrompt)}` : "no prompts";
    const syncStr = syncInfo.lastSync ? `sync: ${formatDate(syncInfo.lastSync)}` : "not synced";
    const right = `${totalStr} · ${lastStr} · ${syncStr}`;
    const pad = Math.max(1, termW - title.length - right.length - 4);
    return [
      `  ${c.bold(c.cyan(title))}${" ".repeat(pad)}${c.dim(right)}`,
      `  ${c.dim("─".repeat(termW - 4))}`,
    ];
  }

  function buildStatusBar() {
    let text;
    if (isSyncing) {
      text = c.yellow("Syncing...") + "  " + c.dim("q:quit");
    } else if (mode === "list") {
      text = `${c.dim("j/k")}nav ${c.dim("enter")}detail ${c.dim("/")}search ${c.dim("f")}fav ${c.dim("d")}del ${c.dim("s")}sync ${c.dim("q")}quit`;
    } else if (mode === "detail") {
      text = `${c.dim("j/k")}scroll ${c.dim("r")}copy-rsp ${c.dim("p")}copy-prmpt ${c.dim("esc")}back`;
    } else if (mode === "search") {
      text = `${c.dim("type")}filter ${c.dim("enter")}select ${c.dim("esc")}clear ${c.dim("arrows")}nav`;
    }
    if (message) {
      text = text + "  |  " + message;
    }
    return "  " + text;
  }

  function buildListLines() {
    const lines = [];
    const vr = visibleContentRows();
    ensureScroll();

    if (filtered.length === 0) {
      lines.push(c.dim("  No prompts found."));
      while (lines.length < vr) lines.push("");
      return lines;
    }

    for (let i = 0; i < vr; i++) {
      const idx = scrollOffset + i;
      if (idx >= filtered.length) {
        lines.push("");
        continue;
      }
      const p = filtered[idx];
      const isSelected = idx === selectedIndex;

      const fav = p.favorite ? c.yellow("★") : " ";
      const date = formatDate(p.created_at);
      const source = p.source || "";
      const project = p.project || "";
      const previewRaw = (p.prompt_text || "").replace(/[\n\r]+/g, " ");

      const dateWidth = 14;
      const sourceWidth = 10;
      const projectWidth = 12;
      const previewWidth = Math.max(10, termW - 4 - dateWidth - 1 - sourceWidth - 1 - projectWidth - 3);

      const dateStr = date.padEnd(dateWidth);
      const sourceStr = truncate(source, sourceWidth).padEnd(sourceWidth);
      const projectStr = truncate(project, projectWidth).padEnd(projectWidth);
      const previewStr = truncate(previewRaw, previewWidth);

      let line = ` ${fav} ${c.dim(dateStr)} ${c.cyan(sourceStr)} ${c.yellow(projectStr)} | ${previewStr}`;
      while (visualLength(line) > termW) {
        line = line.slice(0, -1);
      }
      if (isSelected) {
        line = ANSI.inverse + line.padEnd(termW) + ANSI.reset;
      }

      lines.push(line);
    }
    return lines;
  }

  function buildDetailLines() {
    const lines = [];
    const p = filtered[detailIndex];
    if (!p) {
      lines.push(c.dim("  No prompt selected."));
      return lines;
    }

    const contentWidth = termW - 4;
    const vr = visibleContentRows();

    // Metadata block
    lines.push(`${c.bold("ID:")} ${p.id || ""}`);
    lines.push(`${c.bold("Created:")} ${formatDate(p.created_at)}`);
    lines.push(`${c.bold("Source:")} ${p.source || ""}`);
    lines.push(`${c.bold("CLI:")} ${p.cli_name || ""}`);
    if (p.project) lines.push(`${c.bold("Project:")} ${p.project}`);
    if (p.model) lines.push(`${c.bold("Model:")} ${p.model}`);
    if (p.session_id) lines.push(`${c.bold("Session:")} ${p.session_id}`);
    lines.push(`${c.bold("Length:")} ${p.prompt_length || 0} chars`);
    if (p.response_length) lines.push(`${c.bold("Response:")} ${p.response_length} chars`);
    lines.push("");

    // Prompt
    lines.push(c.bold(c.yellow("Prompt:")));
    lines.push(...wrapText(p.prompt_text || "(empty)", contentWidth));
    lines.push("");

    // Response
    if (p.response_text) {
      lines.push(c.bold(c.yellow("Response:")));
      lines.push(...wrapText(p.response_text, contentWidth));
      lines.push("");
    }

    // Apply scroll
    const maxScroll = Math.max(0, lines.length - vr);
    if (detailScroll > maxScroll) detailScroll = maxScroll;
    if (detailScroll < 0) detailScroll = 0;

    const visible = lines.slice(detailScroll, detailScroll + vr);
    return visible.map((l) => "  " + l.slice(0, contentWidth));
  }

  function buildSearchLines() {
    const lines = [];
    const vr = visibleContentRows();
    const resultRows = vr - 1;

    // Search input line
    const cursor = "_";
    const queryLine = `Search: ${searchQuery}${cursor}`;
    lines.push("  " + c.bold(c.cyan(queryLine.slice(0, termW - 4))));

    ensureScroll();

    if (filtered.length === 0 && searchQuery) {
      lines.push(c.dim("  No matches."));
      while (lines.length < vr) lines.push("");
      return lines;
    }

    for (let i = 0; i < resultRows; i++) {
      const idx = scrollOffset + i;
      if (idx >= filtered.length) {
        lines.push("");
        continue;
      }
      const p = filtered[idx];
      const isSelected = idx === selectedIndex;
      const fav = p.favorite ? c.yellow("★") : " ";
      const date = formatDate(p.created_at);
      const previewRaw = (p.prompt_text || "").replace(/[\n\r]+/g, " ");
      const previewWidth = Math.max(10, termW - 30);
      const previewStr = truncate(previewRaw, previewWidth);

      let line = ` ${fav} ${c.dim(date)} | ${previewStr}`;
      while (visualLength(line) > termW) {
        line = line.slice(0, -1);
      }
      if (isSelected) {
        line = ANSI.inverse + line.padEnd(termW) + ANSI.reset;
      }
      lines.push(line);
    }
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    if (quit) return;

    let output = ANSI.clear + ANSI.hideCursor;

    // Header
    const header = buildHeader();
    output += header[0].slice(0, termW) + "\n";
    output += header[1].slice(0, termW) + "\n";

    // Content
    let contentLines = [];
    if (mode === "list") {
      contentLines = buildListLines();
    } else if (mode === "detail") {
      contentLines = buildDetailLines();
    } else if (mode === "search") {
      contentLines = buildSearchLines();
    }

    const maxContent = visibleContentRows();
    for (let i = 0; i < maxContent; i++) {
      if (i < contentLines.length) {
        output += contentLines[i].slice(0, termW) + "\n";
      } else {
        output += "\n";
      }
    }

    // Status bar
    output += buildStatusBar().slice(0, termW);

    process.stdout.write(output);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function enterDetail() {
    if (filtered.length === 0) return;
    detailIndex = selectedIndex;
    detailScroll = 0;
    mode = "detail";
  }

  function enterSearch() {
    mode = "search";
    searchQuery = "";
    updateFiltered();
  }

  async function toggleCurrentFavorite() {
    if (filtered.length === 0) return;
    const p = filtered[selectedIndex];
    await toggleFavorite(db, p.id, p.favorite);
    p.favorite = !p.favorite;
    const orig = prompts.find((x) => x.id === p.id);
    if (orig) orig.favorite = p.favorite;
    setMessage(p.favorite ? "Favorited" : "Unfavorited");
    render();
  }

  async function deleteCurrentPrompt() {
    if (filtered.length === 0) return;
    const p = filtered[selectedIndex];
    await softDeletePrompt(db, p.id);
    prompts = prompts.filter((x) => x.id !== p.id);
    updateFiltered();
    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }
    setMessage("Deleted");
    render();
  }

  async function runSync() {
    if (isSyncing) return;
    isSyncing = true;
    render();
    try {
      const result = await syncToServer(config, {});
      setMessage(`Synced ${result.uploaded} records`);
      await reloadData();
      updateFiltered();
    } catch (err) {
      setMessage(`Sync failed: ${err.message || "unknown"}`);
    } finally {
      isSyncing = false;
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------
  function handleKey(str, key) {
    if (quit) return;

    if (key.ctrl && key.name === "c") {
      quit = true;
      cleanup();
      process.exit(0);
      return;
    }

    if (mode === "list") {
      handleListKey(str, key);
    } else if (mode === "detail") {
      handleDetailKey(str, key);
    } else if (mode === "search") {
      handleSearchKey(str, key);
    }
  }

  function handleListKey(str, key) {
    if (key.name === "q") {
      quit = true;
      cleanup();
      process.exit(0);
    } else if (key.name === "j" || key.name === "down") {
      if (selectedIndex < filtered.length - 1) selectedIndex++;
    } else if (key.name === "k" || key.name === "up") {
      if (selectedIndex > 0) selectedIndex--;
    } else if (key.name === "g" && key.ctrl) {
      selectedIndex = 0;
    } else if (key.name === "g" && key.shift) {
      selectedIndex = Math.max(0, filtered.length - 1);
    } else if (key.name === "return" || key.name === "enter") {
      enterDetail();
      render();
      return;
    } else if (key.name === "/") {
      enterSearch();
      render();
      return;
    } else if (key.name === "f") {
      toggleCurrentFavorite();
      return;
    } else if (key.name === "d") {
      deleteCurrentPrompt();
      return;
    } else if (key.name === "s") {
      runSync();
      return;
    }
    render();
  }

  function handleDetailKey(str, key) {
    if (key.name === "escape" || key.name === "q") {
      mode = "list";
    } else if (key.name === "j" || key.name === "down") {
      detailScroll++;
    } else if (key.name === "k" || key.name === "up") {
      detailScroll--;
    } else if (key.name === "r") {
      const p = filtered[detailIndex];
      if (p && p.response_text) {
        const ok = copyToClipboard(p.response_text);
        setMessage(ok ? "Response copied" : "Copy failed");
      } else {
        setMessage("No response");
      }
    } else if (key.name === "p") {
      const p = filtered[detailIndex];
      if (p && p.prompt_text) {
        const ok = copyToClipboard(p.prompt_text);
        setMessage(ok ? "Prompt copied" : "Copy failed");
      } else {
        setMessage("No prompt text");
      }
    }
    render();
  }

  function handleSearchKey(str, key) {
    if (key.name === "escape") {
      searchQuery = "";
      updateFiltered();
      mode = "list";
    } else if (key.name === "return" || key.name === "enter") {
      mode = "list";
    } else if (key.name === "backspace") {
      searchQuery = searchQuery.slice(0, -1);
      updateFiltered();
    } else if (key.name === "down") {
      if (selectedIndex < filtered.length - 1) selectedIndex++;
    } else if (key.name === "up") {
      if (selectedIndex > 0) selectedIndex--;
    } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
      searchQuery += str;
      updateFiltered();
    }
    render();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  function cleanup() {
    if (messageTimer) clearTimeout(messageTimer);
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
    process.stdin.removeAllListeners("keypress");
    process.stdin.pause();
    process.stdout.write(ANSI.showCursor + ANSI.clear);
    try {
      db.close();
    } catch {
      // ignore
    }
  }

  process.on("SIGINT", () => {
    quit = true;
    cleanup();
    process.exit(0);
  });

  process.on("SIGWINCH", () => {
    const size = getTermSize();
    termH = size.rows;
    termW = size.cols;
    render();
  });

  process.stdout.on("resize", () => {
    const size = getTermSize();
    termH = size.rows;
    termW = size.cols;
    render();
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", handleKey);

  render();
}

module.exports = { startTui };

const fs = require("fs");
const path = require("path");
const { c, loadClack, handleCancel, label, pass, fail, warn, info } = require("./ui");
const { loadConfig, saveConfig, getConfigSummary } = require("./config");
const {
  installClaudeHook,
  uninstallClaudeHook,
  installCodexHook,
  uninstallCodexHook,
  installGeminiHook,
  uninstallGeminiHook,
  installOpenCodeHook,
  uninstallOpenCodeHook,
  listHookStatus,
} = require("./hooks");
const { ingestPayload, replayQueue } = require("./ingest");
const { getQueueStats } = require("./queue");
const { loadState } = require("./state");
const { getStats } = require("./stats");
const { exportData } = require("./export");
const { syncToServer, postJson } = require("./sync");
const { getSyncStatus, updateSyncState } = require("./sync-log");
const { openDb } = require("./db");

// ---------------------------------------------------------------------------
// Version & Help
// ---------------------------------------------------------------------------

function getVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
    );
    return pkg.version;
  } catch {
    return "dev";
  }
}

function printHelp() {
  const v = getVersion();
  const d = c.dim;
  const cmd = (name, desc) => `    ${c.cyan(name.padEnd(19))}${d(desc)}`;
  console.log(`
  ${c.bold(c.cyan("oh-my-prompt"))} ${d("v" + v)}
  ${d("CLI prompt journal for AI coding assistants")}

  ${c.yellow("USAGE")}
    ${c.bold("omp")} ${d("<command> [options]")}

  ${c.yellow("COMMANDS")}
${cmd("setup", "Interactive setup wizard")}
${cmd("install", "Install hooks for Claude Code / Codex / OpenCode")}
${cmd("uninstall", "Remove hooks (--all for full cleanup)")}
${cmd("status", "Show current configuration and hook status")}
${cmd("doctor", "Diagnose common issues")}

${cmd("sync", "Upload local records to server")}
${cmd("sync status", "Show sync checkpoint and recent runs")}
${cmd("sync flush", "Delete all server-side records (destructive)")}
${cmd("sync auto", "Start background auto-sync daemon")}
${cmd("sync auto stop", "Stop auto-sync daemon")}
${cmd("sync auto status", "Show auto-sync daemon status")}

${cmd("backfill", "Import from Claude transcripts / Codex history")}
${cmd("import", "Import from external sources")}
${cmd("ingest", "Ingest a raw JSON payload (used by hooks)")}

${cmd("stats", "Show prompt statistics")}
${cmd("report", "Generate summary report for a time range")}
${cmd("analyze [id]", "Analyze a prompt (default: most recent)")}
${cmd("ask", 'Ask a question about your prompts')}
${cmd("export", "Export records (json, csv, jsonl)")}

${cmd("serve", "Start local dashboard server (Docker)")}
${cmd("serve stop", "Stop local dashboard server")}
${cmd("serve status", "Show local server status")}
${cmd("serve logs", "Tail local server logs")}

${cmd("config get [key]", "Read config value (omit key for full dump)")}
${cmd("config set <k> <v>", "Write config value")}
${cmd("config validate", "Validate configuration")}

${cmd("db migrate", "Run database migrations")}
${cmd("db flush", "Delete all local records (destructive)")}

  ${c.yellow("GLOBAL OPTIONS")}
    ${c.cyan("--help, -h")}         ${d("Show help for any command")}
    ${c.cyan("--version, -v")}      ${d("Print version")}
    ${c.cyan("--json")}             ${d("Machine-readable JSON output")}

  ${c.yellow("EXAMPLES")}
    ${c.bold("omp setup")}                          ${d("# First-time setup")}
    ${c.bold("omp status")}                         ${d("# Check everything is working")}
    ${c.bold("omp sync")}                           ${d("# Upload to server")}
    ${c.bold("omp backfill --claude-only")}         ${d("# Import Claude transcripts")}
    ${c.bold("omp stats --since 2025-01-01")}       ${d("# Stats from date")}
    ${c.bold("omp export --format csv --out .")}    ${d("# Export as CSV")}

  ${d("https://github.com/jiunbae/oh-my-prompt")}
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [key, inlineValue] = arg.replace(/^--/, "").split("=");
      if (inlineValue !== undefined) {
        options[key] = inlineValue;
        continue;
      }
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        i += 1;
      }
    } else if (arg === "-v") {
      options.version = true;
    } else if (arg === "-h") {
      options.help = true;
    } else if (arg === "-y") {
      options.yes = true;
    } else {
      positional.push(arg);
    }
  }

  const command = positional.shift() || null;
  return { command, options, positional };
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.resume();
  });
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return value === "true";
}

function commandExists(cmd) {
  const { spawnSync } = require("child_process");
  const result = spawnSync("which", [cmd], { stdio: "ignore" });
  return result.status === 0;
}

function detectCliTargets() {
  const targets = [];
  const home = require("os").homedir();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  if (commandExists("claude") || fs.existsSync(path.join(home, ".claude"))) {
    targets.push("claude");
  }
  if (commandExists("codex") || fs.existsSync(path.join(home, ".codex"))) {
    targets.push("codex");
  }
  if (commandExists("gemini") || fs.existsSync(path.join(home, ".gemini"))) {
    targets.push("gemini");
  }
  if (commandExists("opencode") || fs.existsSync(path.join(xdgConfigHome, "opencode"))) {
    targets.push("opencode");
  }
  return targets;
}

function resolveCliList(cliOption) {
  if (!cliOption) {
    return detectCliTargets();
  }
  if (cliOption === "all") {
    return ["claude", "codex", "gemini", "opencode"];
  }
  return cliOption.split(",").map((entry) => entry.trim());
}

async function handleInstall(options) {
  const config = loadConfig();

  // Server config (new, preferred)
  if (options.server) config.server.url = options.server;
  if (options.token) config.server.token = options.token;

  if (options["sqlite-path"]) config.storage.sqlite.path = options["sqlite-path"];
  if (options["capture-response"] !== undefined) {
    config.capture.response = parseBoolean(options["capture-response"], true);
  }

  const targets = resolveCliList(options.cli);
  if (!targets.length) {
    console.error("No supported CLI detected. Use --cli to specify a target.");
    process.exitCode = 2;
    return [];
  }

  const installed = [];

  if (targets.includes("claude") || targets.includes("claude-code")) {
    const hookPath = installClaudeHook();
    config.hooks.enabled.claude_code = true;
    installed.push({ cli: "claude", path: hookPath });
  }

  if (targets.includes("codex")) {
    const codexResult = installCodexHook();
    config.hooks.enabled.codex = codexResult.configured;
    installed.push({
      cli: "codex",
      path: codexResult.scriptPath,
      configPath: codexResult.configPath,
      configured: codexResult.configured,
      conflict: codexResult.conflict,
      merged: codexResult.merged,
    });
  }

  if (targets.includes("gemini")) {
    const geminiResult = installGeminiHook();
    config.hooks.enabled.gemini = geminiResult.configured;
    installed.push({
      cli: "gemini",
      path: geminiResult.scriptPath,
      configPath: geminiResult.settingsPath,
      configured: geminiResult.configured,
    });
  }

  if (targets.includes("opencode")) {
    const opencodeResult = installOpenCodeHook();
    config.hooks.enabled.opencode = opencodeResult.configured;
    installed.push({
      cli: "opencode",
      path: opencodeResult.scriptPath,
      configPath: opencodeResult.configPath,
      configured: opencodeResult.configured,
      conflict: opencodeResult.conflict,
    });
  }

  saveConfig(config);

  // Start auto-sync daemon if enabled
  if (config.sync?.auto) {
    try {
      const { startDaemon } = require("./auto-sync");
      const daemonResult = startDaemon(config);
      if (daemonResult.errors && daemonResult.errors.length) {
        console.warn("Warning: auto-sync daemon failed to start: " + daemonResult.errors.join("; "));
      }
    } catch (err) {
      console.warn("Warning: auto-sync daemon failed to start: " + (err.message || "unknown error"));
    }
  }

  return installed;
}

async function askConfirm(question, defaultYes = false) {
  if (process.stdin.isTTY) {
    try {
      const clack = await loadClack();
      const result = await clack.confirm({
        message: question,
        initialValue: defaultYes,
      });
      handleCancel(result);
      return result;
    } catch {
      // fallback below
    }
  }
  const readline = require("readline");
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  > ${question} [${hint}]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) return resolve(defaultYes);
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

async function handleUninstall(options) {
  const {
    getConfigDir,
    getConfigPath,
    getDefaultSqlitePath,
  } = require("./paths");

  const isAll = options.all || options.cli === "all";
  const isFull = isAll && !options["hooks-only"];
  const interactive = process.stdin.isTTY && !options.yes && !options.y;

  // Stop auto-sync daemon if running
  try {
    const { stopDaemon } = require("./auto-sync");
    stopDaemon();
  } catch (err) {
    console.warn("Warning: auto-sync daemon failed to stop: " + (err.message || "unknown error"));
  }

  // If --all flag: full uninstall (hooks + config + data)
  if (isFull) {
    const configDir = getConfigDir();
    const dbPath = getDefaultSqlitePath();
    const dbExists = fs.existsSync(dbPath);
    const configExists = fs.existsSync(getConfigPath());

    let removeDb = true;

    if (interactive) {
      console.log("\n  Oh My Prompt - Full Uninstall");
      console.log("  ==============================\n");
      console.log("  This will remove:");
      console.log("    - Claude Code hook (~/.claude/hooks/prompt-logger.sh)");
      console.log("    - Codex hook (~/.config/oh-my-prompt/hooks/)");
      console.log("    - OpenCode plugin hook (~/.config/oh-my-prompt/hooks/opencode/)");
      if (configExists) console.log("    - Configuration (~/.config/oh-my-prompt/config.json)");
      if (dbExists) console.log("    - Local database (~/.config/oh-my-prompt/omp.db)");
      console.log("    - All data in " + configDir);
      console.log("");

      const proceed = await askConfirm("Are you sure you want to remove everything?", false);
      if (!proceed) {
        console.log("\n  Uninstall cancelled.\n");
        return [];
      }

      if (dbExists) {
        removeDb = await askConfirm("Also delete local prompt database (omp.db)?", false);
      }
    }

    console.log("");

    // Remove hooks
    const removed = [];
    try {
      const hookPath = uninstallClaudeHook();
      if (hookPath) {
        removed.push({ cli: "claude", path: hookPath });
        console.log("  Removed Claude Code hook: " + hookPath);
      }
    } catch { /* ignore */ }

    try {
      const codexResult = uninstallCodexHook();
      if (codexResult.scriptPath || codexResult.removed) {
        removed.push({ cli: "codex", path: codexResult.scriptPath });
        console.log("  Removed Codex hook: " + (codexResult.scriptPath || ""));
      }
    } catch { /* ignore */ }

    try {
      const geminiResult = uninstallGeminiHook();
      if (geminiResult.removed) {
        removed.push({ cli: "gemini", path: geminiResult.scriptPath });
        console.log("  Removed Gemini hook: " + (geminiResult.scriptPath || ""));
      }
    } catch { /* ignore */ }

    try {
      const opencodeResult = uninstallOpenCodeHook();
      if (opencodeResult.scriptPath || opencodeResult.removed || opencodeResult.configUpdated) {
        removed.push({ cli: "opencode", path: opencodeResult.scriptPath });
        console.log("  Removed OpenCode hook: " + (opencodeResult.scriptPath || ""));
      }
    } catch { /* ignore */ }

    // Remove config dir contents
    const configDir2 = getConfigDir();
    if (fs.existsSync(configDir2)) {
      const entries = fs.readdirSync(configDir2, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(configDir2, entry.name);
        // Skip database if user chose to keep it
        if (!removeDb && entry.name === "omp.db") continue;
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
      // Remove dir itself if empty
      try {
        const remaining = fs.readdirSync(configDir2);
        if (remaining.length === 0) fs.rmdirSync(configDir2);
      } catch { /* ignore */ }
      console.log("  Removed config directory: " + configDir2);
    }

    if (!removeDb && dbExists) {
      console.log("  Kept local database: " + dbPath);
    }

    console.log("\n  Uninstall complete. Run 'omp setup' to reconfigure.\n");
    return removed;
  }

  // Original behavior: remove specific hooks only
  let config;
  try {
    config = loadConfig();
  } catch {
    config = require("./config").defaultConfig();
  }
  const targets = resolveCliList(options.cli);
  const removed = [];

  if (targets.includes("claude") || targets.includes("claude-code")) {
    const hookPath = uninstallClaudeHook();
    config.hooks.enabled.claude_code = false;
    if (hookPath) removed.push({ cli: "claude", path: hookPath });
  }

  if (targets.includes("codex")) {
    const codexResult = uninstallCodexHook();
    config.hooks.enabled.codex = false;
    if (codexResult.scriptPath || codexResult.removed) {
      removed.push({
        cli: "codex",
        path: codexResult.scriptPath,
        configPath: codexResult.configPath,
        removed: codexResult.removed,
      });
    }
  }

  if (targets.includes("gemini")) {
    const geminiResult = uninstallGeminiHook();
    config.hooks.enabled.gemini = false;
    if (geminiResult.removed) {
      removed.push({
        cli: "gemini",
        path: geminiResult.scriptPath,
        removed: geminiResult.removed,
      });
    }
  }

  if (targets.includes("opencode")) {
    const opencodeResult = uninstallOpenCodeHook();
    config.hooks.enabled.opencode = false;
    if (opencodeResult.scriptPath || opencodeResult.removed || opencodeResult.configUpdated) {
      removed.push({
        cli: "opencode",
        path: opencodeResult.scriptPath,
        configPath: opencodeResult.configPath,
        removed: opencodeResult.removed,
      });
    }
  }

  if (options["remove-config"]) {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } else {
    saveConfig(config);
  }

  return removed;
}

function handleStatus(options) {
  const config = loadConfig();
  const hooks = listHookStatus();
  const summary = getConfigSummary(config);
  const state = loadState();
  const queueStats = getQueueStats();

  const db = openDb(config.storage.sqlite.path);
  const lastRow = db
    .prepare("SELECT created_at FROM prompts ORDER BY created_at DESC LIMIT 1")
    .get();
  db.close();

  const status = {
    server: summary.serverUrl || "(not configured)",
    serverToken: summary.serverToken,
    storage: summary.storageType,
    sqlitePath: summary.sqlitePath,
    captureResponse: summary.captureResponse,
    hooks,
    lastCapture: lastRow ? lastRow.created_at : null,
    queue: queueStats,
    lastError: state.lastError || null,
    lastReplay: state.lastReplay || null,
  };

  if (options.json) {
    printJson(status);
  } else {
    const hookIcon = (v) => (v ? c.green("installed") : c.dim("not installed"));
    console.log(label("Server", status.server === "(not configured)" ? c.yellow(status.server) : c.cyan(status.server)));
    console.log(label("Token", status.serverToken ? c.dim(status.serverToken) : c.yellow("(not set)")));
    console.log(label("Storage", status.storage));
    console.log(label("SQLite", c.dim(status.sqlitePath)));
    console.log(label("Capture response", status.captureResponse ? c.green("on") : c.dim("off")));
    console.log(label("Hooks", `claude=${hookIcon(hooks.claude_code)}, codex=${hookIcon(hooks.codex)}, gemini=${hookIcon(hooks.gemini)}, opencode=${hookIcon(hooks.opencode)}`));
    console.log(label("Last capture", status.lastCapture || c.dim("none")));
    console.log(label("Queue", `${queueStats.count} files, ${queueStats.bytes} bytes`));
    if (state.lastReplay) {
      console.log(
        label("Last replay", `${state.lastReplay.at} (processed ${state.lastReplay.processed}, failed ${state.lastReplay.failed})`)
      );
    }
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function setConfigValue(config, keyPath, value) {
  const keys = keyPath.split(".");
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Invalid config key: "${key}" is not allowed`);
    }
  }
  let current = config;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (!Number.isNaN(Number(raw)) && raw.trim() !== "") return Number(raw);
  return raw;
}

function handleConfig(options, positional) {
  const config = loadConfig();
  const action = positional[0];
  const key = positional[1];

  if (action === "set") {
    const value = positional[2];
    if (!key || value === undefined) {
      console.error("Usage: omp config set <path> <value>");
      process.exitCode = 2;
      return;
    }
    setConfigValue(config, key, parseValue(value));
    saveConfig(config);
    if (options.json) {
      printJson({ ok: true, key, value: parseValue(value) });
    } else {
      console.log(`Updated ${key}`);
    }
    return;
  }

  if (action === "validate") {
    const { validateConfig } = require("./doctor");
    const result = validateConfig(config);
    if (options.json) {
      printJson(result);
    } else {
      if (result.ok) {
        console.log(pass("Config OK"));
      }
      if (result.errors.length) {
        console.log(c.red("\nErrors:"));
        result.errors.forEach((e) => console.log(fail(e)));
      }
      if (result.warnings.length) {
        console.log(c.yellow("\nWarnings:"));
        result.warnings.forEach((w) => console.log(warn(w)));
      }
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === "get") {
    if (!key) {
      printJson(config);
      return;
    }
    const value = key
      .split(".")
      .reduce((acc, part) => (acc ? acc[part] : undefined), config);
    if (options.json) {
      printJson({ key, value });
    } else {
      console.log(value === undefined ? "" : value);
    }
    return;
  }

  console.error("Usage: omp config <get|set> [path] [value]");
  process.exitCode = 2;
}

async function handleImport(options, positional) {
  const config = loadConfig();
  const source = positional[0];
  if (source !== "codex-history") {
    console.error("Usage: omp import codex-history [--path <file>] [--dry-run]");
    process.exitCode = 2;
    return;
  }
  const { importCodexHistory } = require("./importer");
  const result = await importCodexHistory(config, {
    path: options.path,
    dryRun: !!options["dry-run"],
  });
  if (options.json) {
    printJson(result);
  } else {
    console.log(`Imported ${result.imported} records (skipped ${result.skipped}).`);
  }
}

function handleStats(options) {
  const config = loadConfig();
  const stats = getStats(config, {
    since: options.since,
    until: options.until,
    groupBy: options["group-by"],
  });

  if (options.json) {
    printJson(stats);
    return;
  }

  console.log("Overall:");
  console.log(stats.overall);
  if (stats.grouped) {
    console.log("Grouped:");
    console.table(stats.grouped);
  }
}

function handleExport(options) {
  const config = loadConfig();
  const result = exportData(config, {
    format: options.format,
    since: options.since,
    until: options.until,
    out: options.out,
  });

  if (!options.out) {
    process.stdout.write(result.output);
  } else if (options.json) {
    printJson({ count: result.count, output: result.output });
  } else {
    console.log(`Exported ${result.count} records to ${result.output}`);
  }
}

async function handleSync(options) {
  const config = loadConfig();
  const { acquireSyncLock, releaseSyncLock } = require("./sync-lock");
  const lock = acquireSyncLock({
    force: !!options.force,
    ttlMs: options["lock-ttl"] ? Number(options["lock-ttl"]) : undefined,
  });

  if (!lock.ok) {
    console.error(fail("Sync already running. Use --force to override."));
    process.exitCode = 1;
    return;
  }

  const useSpinner = !options.json && process.stdout.isTTY;
  let s, clack;
  if (useSpinner) {
    clack = await loadClack();
    s = clack.spinner();
    s.start("Syncing records...");
  }

  try {
    const syncOptions = {
      dryRun: !!options["dry-run"],
      since: options.since,
      chunkSize: options["chunk-size"] ? Number(options["chunk-size"]) : undefined,
    };

    const result = await syncToServer(config, syncOptions);

    if (options.json) {
      printJson(result);
    } else if (s) {
      const parts = [`Synced ${c.bold(result.uploaded)} records in ${result.chunks} request(s)`];
      if (result.duplicates) parts.push(c.dim(`(${result.duplicates} duplicates skipped)`));
      if (result.rejected) parts.push(c.yellow(`(${result.rejected} rejected)`));
      s.stop(parts.join(" "));
    } else {
      console.log(`Synced ${result.uploaded} records in ${result.chunks} request(s)`);
      if (result.duplicates) console.log(`  Duplicates skipped: ${result.duplicates}`);
      if (result.rejected) console.log(`  Rejected: ${result.rejected}`);
    }
  } catch (err) {
    if (s) s.stop(c.red("Sync failed."));
    throw err;
  } finally {
    releaseSyncLock(lock.lockPath);
  }
}

function handleSyncStatus(options) {
  const config = loadConfig();
  const status = getSyncStatus(config, options.limit ? Number(options.limit) : 5);
  if (options.json) {
    printJson(status);
    return;
  }
  const checkpoint = status.checkpoint;
  const checkpointText =
    checkpoint && checkpoint.lastSyncedAt
      ? `${checkpoint.lastSyncedAt} (${checkpoint.lastSyncedId || "no-id"})`
      : "none";
  console.log(`Checkpoint: ${checkpointText}`);
  if (status.lastSuccess) {
    console.log(`Last success: ${status.lastSuccess.completed_at || status.lastSuccess.started_at}`);
  }
  if (status.lastFailure) {
    console.log(`Last failure: ${status.lastFailure.completed_at || status.lastFailure.started_at}`);
  }
  if (status.recent && status.recent.length) {
    console.log("Recent syncs:");
    status.recent.forEach((log) => {
      console.log(
        `- ${log.status} at ${log.started_at} (${log.records_uploaded} records, ${log.files_uploaded} files)`
      );
    });
  }
}

async function handleSyncFlush(options) {
  if (options.help) {
    console.log("Usage: omp sync flush [--yes]");
    console.log("");
    console.log("Delete ALL server-side records for your account.");
    console.log("");
    console.log("Options:");
    console.log("  --yes, -y   Skip confirmation prompt");
    console.log("  --json      Output results as JSON");
    return;
  }

  const config = loadConfig();
  const serverUrl = config.server?.url;
  const serverToken = config.server?.token;

  if (!serverUrl || !serverToken) {
    console.error(
      "Server not configured. Set server.url and server.token:\n" +
        "  omp config set server.url https://prompt.jiun.dev\n" +
        "  omp config set server.token YOUR_TOKEN"
    );
    process.exitCode = 1;
    return;
  }

  if (!options.yes && !options.y) {
    console.log("This will delete ALL server-side records for your account.");
    console.log("Run with --yes to confirm.");
    process.exitCode = 1;
    return;
  }

  const flushUrl = `${serverUrl.replace(/\/$/, "")}/api/sync/flush`;
  const headers = { "X-User-Token": serverToken };

  try {
    const response = await postJson(flushUrl, headers, {}, "DELETE");
    if (response.status === 401) {
      throw new Error("Authentication failed. Check server.token.");
    }
    if (response.status >= 400) {
      throw new Error(`Server error (${response.status}): ${JSON.stringify(response.body)}`);
    }

    // Reset local sync state so next sync re-uploads everything
    updateSyncState(config, null, null);

    if (options.json) {
      printJson({ flushed: true, deleted: response.body.deleted || 0 });
    } else {
      console.log(`Server data flushed. ${response.body.deleted || 0} records deleted.`);
      console.log("Local sync state reset. Run 'omp sync' to re-upload.");
    }
  } catch (error) {
    console.error(`Flush failed: ${error.message}`);
    process.exitCode = 1;
  }
}

function handleSyncAuto(options, positional) {
  const { startDaemon, stopDaemon, daemonStatus } = require("./auto-sync");
  const config = loadConfig();
  const subAction = positional[0];

  if (subAction === "stop") {
    const result = stopDaemon();
    if (options.json) {
      printJson(result);
    } else if (result.stopped && result.timedOut) {
      console.log(`Auto-sync daemon force-killed after timeout (pid ${result.pid}).`);
    } else if (result.stopped) {
      console.log(`Auto-sync daemon stopped (pid ${result.pid}).`);
    } else {
      console.log("Auto-sync daemon is not running.");
    }
    return;
  }

  if (subAction === "status") {
    const status = daemonStatus();
    if (options.json) {
      printJson(status);
    } else {
      if (status.running) {
        console.log(`Auto-sync daemon: running (pid ${status.pid})`);
      } else {
        console.log("Auto-sync daemon: not running");
      }
      console.log(`Last sync: ${status.lastSyncTime || "never"}`);
      console.log(`PID file: ${status.pidFile}`);
      console.log(`Log file: ${status.logFile}`);
    }
    return;
  }

  // Default: start the daemon
  const result = startDaemon(config);

  // Persist sync.auto=true on successful start (consistent across output modes)
  if (result.started) {
    config.sync.auto = true;
    saveConfig(config);
  }

  if (options.json) {
    printJson(result);
  } else if (result.alreadyRunning) {
    console.log(`Auto-sync daemon already running (pid ${result.pid}).`);
  } else if (result.started) {
    console.log(`Auto-sync daemon started (pid ${result.pid}).`);
    console.log(`Debounce: ${config.sync.debounce || 30}s, interval: ${config.sync.interval || 300}s`);
  } else if (result.errors && result.errors.length) {
    console.error("Failed to start auto-sync daemon:");
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exitCode = 1;
  } else {
    console.error("Failed to start auto-sync daemon.");
    process.exitCode = 1;
  }
}

async function handleIngest(options) {
  const config = loadConfig();
  if (options.replay) {
    const result = replayQueue(config);
    if (options.json) {
      printJson(result);
    } else {
      console.log(`Replayed ${result.processed} records, failed ${result.failed}.`);
    }
    return;
  }

  let rawPayload = typeof options.json === "string" ? options.json : (options.payload || null);
  if (options.stdin || !process.stdin.isTTY) {
    rawPayload = await readStdin();
  }

  if (!rawPayload) {
    console.error("No payload provided.");
    process.exitCode = 2;
    return;
  }

  const result = ingestPayload(rawPayload, config);
  if (options.json === true) {
    printJson(result);
  } else if (!result.ok) {
    console.error(result.error || "Failed to ingest");
    process.exitCode = 1;
  }
}

async function handleAsk(options, positional) {
  const config = loadConfig();
  const serverUrl = config.server?.url;
  const serverToken = config.server?.token;

  if (!serverUrl || !serverToken) {
    console.error("Server not configured. Run 'omp setup' first.");
    process.exitCode = 1;
    return;
  }

  const question = positional.join(" ").trim();
  if (!question) {
    console.error("Usage: omp ask \"your question about prompts\"");
    process.exitCode = 2;
    return;
  }

  const url = `${serverUrl.replace(/\/$/, "")}/api/insights/ask`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Token": serverToken,
      },
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`Server error (${res.status}): ${body.error || "Unknown error"}`);
      process.exitCode = 1;
      return;
    }

    const result = await res.json();

    if (options.json) {
      printJson(result);
      return;
    }

    console.log("");
    console.log(`  ${c.bold(c.cyan(result.title || "Answer"))}`);
    console.log("");
    console.log(`  ${result.summary || "No summary available."}`);

    if (result.highlights && result.highlights.length) {
      console.log("");
      for (const h of result.highlights) {
        console.log(`  ${c.dim(h.label + ":")} ${c.bold(String(h.value))}`);
      }
    }

    if (result.trends && result.trends.length) {
      console.log("");
      console.log(`  ${c.yellow("Trends:")}`);
      for (const t of result.trends) {
        const arrow = t.direction === "up" ? c.green("\u2191") : t.direction === "down" ? c.red("\u2193") : c.dim("\u2192");
        console.log(`  ${arrow} ${t.metric}: ${t.explanation}`);
      }
    }

    if (result.recommendations && result.recommendations.length) {
      console.log("");
      console.log(`  ${c.yellow("Recommendations:")}`);
      for (const r of result.recommendations) {
        console.log(`  ${c.dim("\u2022")} ${r}`);
      }
    }

    if (result.confidence !== undefined) {
      console.log("");
      console.log(`  ${c.dim("Confidence:")} ${Math.round(result.confidence * 100)}%`);
    }
    console.log("");
  } catch (err) {
    console.error(`Failed to reach server: ${err.message}`);
    process.exitCode = 1;
  }
}

function handleAnalyze(options, positional) {
  const config = loadConfig();
  const db = openDb(config.storage.sqlite.path);
  const promptId = positional[0];

  let row;
  if (promptId) {
    row = db.prepare("SELECT * FROM prompts WHERE id = ?").get(promptId);
    if (!row) {
      db.close();
      console.error(`Prompt not found: ${promptId}`);
      process.exitCode = 1;
      return;
    }
  } else {
    row = db.prepare("SELECT * FROM prompts ORDER BY created_at DESC LIMIT 1").get();
    if (!row) {
      db.close();
      console.error("No prompts found in the database.");
      process.exitCode = 1;
      return;
    }
  }

  // Fetch quality review if exists
  let review = null;
  try {
    review = db.prepare("SELECT * FROM prompt_reviews WHERE prompt_id = ?").get(row.id);
  } catch {
    // table may not exist
  }

  db.close();

  if (options.json) {
    printJson({ prompt: row, review: review || null });
    return;
  }

  console.log("");
  console.log(`  ${c.bold(c.cyan("Prompt Analysis"))}`);
  console.log("");
  console.log(label("  ID", row.id));
  console.log(label("  Created", row.created_at));
  console.log(label("  Source", c.cyan(row.source)));
  console.log(label("  CLI", row.cli_name));
  if (row.project) console.log(label("  Project", c.bold(row.project)));
  if (row.session_id) console.log(label("  Session", c.dim(row.session_id)));
  if (row.model) console.log(label("  Model", row.model));

  console.log("");
  console.log(`  ${c.yellow("Prompt Text:")}`);
  const promptText = row.prompt_text || "(empty)";
  const truncated = promptText.length > 500 ? promptText.slice(0, 500) + c.dim("... (truncated)") : promptText;
  console.log(`  ${truncated}`);

  if (row.response_text) {
    console.log("");
    console.log(`  ${c.yellow("Response:")}`);
    const respTruncated = row.response_text.length > 500
      ? row.response_text.slice(0, 500) + c.dim("... (truncated)")
      : row.response_text;
    console.log(`  ${respTruncated}`);
  }

  console.log("");
  console.log(`  ${c.yellow("Metadata:")}`);
  console.log(label("  Prompt length", `${row.prompt_length} chars`));
  if (row.response_length) console.log(label("  Response length", `${row.response_length} chars`));
  if (row.token_estimate) console.log(label("  Tokens (prompt)", String(row.token_estimate)));
  if (row.token_estimate_response) console.log(label("  Tokens (response)", String(row.token_estimate_response)));
  if (row.word_count) console.log(label("  Words (prompt)", String(row.word_count)));

  if (review) {
    console.log("");
    console.log(`  ${c.yellow("Quality Score:")} ${c.bold(String(review.score))} / 100`);
    try {
      const signals = JSON.parse(review.signals_json);
      if (Array.isArray(signals) && signals.length) {
        for (const sig of signals) {
          const icon = sig.positive ? c.green("+") : c.red("-");
          console.log(`  ${icon} ${sig.label || sig.name || sig}`);
        }
      }
    } catch { /* ignore */ }
    try {
      const suggestions = JSON.parse(review.suggestions_json);
      if (Array.isArray(suggestions) && suggestions.length) {
        console.log("");
        console.log(`  ${c.yellow("Suggestions:")}`);
        for (const s of suggestions) {
          console.log(`  ${c.dim("\u2022")} ${typeof s === "string" ? s : s.text || JSON.stringify(s)}`);
        }
      }
    } catch { /* ignore */ }
  }
  console.log("");
}

function handleReport(options) {
  const config = loadConfig();
  const db = openDb(config.storage.sqlite.path);

  const where = [];
  const params = [];

  if (options.since) {
    const sinceDate = new Date(options.since);
    if (isNaN(sinceDate.getTime())) {
      console.error("Invalid --since date");
      process.exitCode = 2;
      return;
    }
    where.push("p.created_at >= ?");
    params.push(sinceDate.toISOString());
  }
  if (options.until) {
    const untilDate = new Date(options.until);
    if (isNaN(untilDate.getTime())) {
      console.error("Invalid --until date");
      process.exitCode = 2;
      return;
    }
    untilDate.setHours(23, 59, 59, 999);
    where.push("p.created_at <= ?");
    params.push(untilDate.toISOString());
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const overall = db.prepare(
    `SELECT
      COUNT(*) as total_prompts,
      SUM(token_estimate) as total_tokens,
      SUM(token_estimate_response) as total_tokens_response,
      AVG(prompt_length) as avg_length,
      COUNT(DISTINCT project) as project_count,
      COUNT(DISTINCT session_id) as session_count,
      COUNT(DISTINCT source) as source_count,
      MIN(created_at) as first_prompt,
      MAX(created_at) as last_prompt
    FROM prompts p ${whereClause}`
  ).get(...params);

  const topProjects = db.prepare(
    `SELECT project, COUNT(*) as count, SUM(token_estimate) as tokens
    FROM prompts p ${whereClause ? whereClause + " AND" : "WHERE"} project IS NOT NULL AND project != ''
    GROUP BY project ORDER BY count DESC LIMIT 10`
  ).all(...params);

  const topSessions = db.prepare(
    `SELECT session_id, COUNT(*) as count, MIN(created_at) as started, MAX(created_at) as ended
    FROM prompts p ${whereClause ? whereClause + " AND" : "WHERE"} session_id IS NOT NULL AND session_id != ''
    GROUP BY session_id ORDER BY count DESC LIMIT 5`
  ).all(...params);

  const sourceBreakdown = db.prepare(
    `SELECT source, COUNT(*) as count
    FROM prompts p ${whereClause}
    GROUP BY source ORDER BY count DESC`
  ).all(...params);

  let qualityStats = null;
  try {
    qualityStats = db.prepare(
      `SELECT AVG(r.score) as avg_score, MIN(r.score) as min_score, MAX(r.score) as max_score, COUNT(*) as reviewed_count
      FROM prompt_reviews r
      JOIN prompts p ON r.prompt_id = p.id
      ${whereClause}`
    ).get(...params);
  } catch { /* table may not exist */ }

  db.close();

  const report = {
    overall,
    topProjects,
    topSessions,
    sourceBreakdown,
    qualityStats,
  };

  if (options.json || options.format === "json") {
    printJson(report);
    return;
  }

  console.log("");
  console.log(`  ${c.bold(c.cyan("Prompt Report"))}`);
  if (options.since || options.until) {
    const range = [options.since || "...", options.until || "now"].join(" \u2192 ");
    console.log(`  ${c.dim(range)}`);
  }
  console.log("");

  console.log(`  ${c.yellow("Overview:")}`);
  console.log(label("  Total prompts", c.bold(String(overall.total_prompts || 0))));
  console.log(label("  Total tokens", String(overall.total_tokens || 0)));
  console.log(label("  Total response tokens", String(overall.total_tokens_response || 0)));
  console.log(label("  Avg prompt length", `${Math.round(overall.avg_length || 0)} chars`));
  console.log(label("  Projects", String(overall.project_count || 0)));
  console.log(label("  Sessions", String(overall.session_count || 0)));
  if (overall.first_prompt) {
    console.log(label("  Date range", `${overall.first_prompt} \u2192 ${overall.last_prompt}`));
  }

  if (sourceBreakdown.length) {
    console.log("");
    console.log(`  ${c.yellow("Sources:")}`);
    for (const s of sourceBreakdown) {
      console.log(`  ${c.dim("\u2022")} ${s.source}: ${c.bold(String(s.count))} prompts`);
    }
  }

  if (topProjects.length) {
    console.log("");
    console.log(`  ${c.yellow("Top Projects:")}`);
    for (const p of topProjects) {
      console.log(`  ${c.dim("\u2022")} ${c.bold(p.project)}: ${p.count} prompts, ${p.tokens || 0} tokens`);
    }
  }

  if (topSessions.length) {
    console.log("");
    console.log(`  ${c.yellow("Most Active Sessions:")}`);
    for (const s of topSessions) {
      const sid = s.session_id.length > 16 ? s.session_id.slice(0, 16) + "..." : s.session_id;
      console.log(`  ${c.dim("\u2022")} ${sid}: ${s.count} prompts (${s.started} \u2192 ${s.ended})`);
    }
  }

  if (qualityStats && qualityStats.reviewed_count > 0) {
    console.log("");
    console.log(`  ${c.yellow("Quality Trends:")}`);
    console.log(label("  Reviewed prompts", String(qualityStats.reviewed_count)));
    console.log(label("  Avg score", `${Math.round(qualityStats.avg_score)} / 100`));
    console.log(label("  Score range", `${qualityStats.min_score} \u2192 ${qualityStats.max_score}`));
  }
  console.log("");
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));

  // Global flags: --version, --help (before any command)
  if (options.version || options.v) {
    console.log(getVersion());
    return;
  }
  if (!command || command === "help" || options.help || options.h) {
    if (!command || command === "help") {
      printHelp();
      return;
    }
    // Fall through to per-command --help below
  }

  switch (command) {
    case "setup": {
      if (options.help || options.h) {
        console.log(`
  omp setup — Interactive setup wizard

  USAGE
    omp setup [options]

  OPTIONS
    --server <url>    Server URL
    --token <token>   Authentication token
    --device <name>   Device name (default: hostname)
    --hooks <targets> Comma-separated: claude,codex,opencode,all,none
    --no-hooks        Skip hook installation
    --skip-validate   Skip server token validation
    --yes, -y         Non-interactive mode, accept all defaults
    --dry-run         Show what would be done without changes
    --json            Output as JSON
`);
        break;
      }
      const { runSetup } = require("./setup");
      const setupResult = await runSetup(options);
      if (!setupResult.ok) process.exitCode = 1;
      break;
    }
    case "install": {
      if (options.help || options.h) {
        console.log(`
  omp install — Install hooks for Claude Code / Codex / Gemini / OpenCode

  USAGE
    omp install [options]

  OPTIONS
    --cli <targets>           Comma-separated: claude,codex,gemini,opencode,all (default: auto-detect)
    --server <url>            Server URL
    --token <token>           Authentication token
    --sqlite-path <path>      Custom SQLite database path
    --capture-response <bool> Enable response capture (default: true)
    --json                    Output as JSON
`);
        break;
      }
      const installed = await handleInstall(options);
      if (options.json) {
        printJson({ installed });
      } else {
        installed.forEach((item) => {
          console.log(`Installed ${item.cli} hook at ${item.path}`);
          if (item.cli === "codex" && item.conflict) {
            console.log(
              "Codex notify is already configured. Please add Oh My Prompt notify manually or replace the existing notify entry."
            );
          }
          if (item.cli === "codex" && item.merged) {
            console.log("Codex notify merged via wrapper.");
          }
          if (item.cli === "codex" && item.configured) {
            console.log(`Codex config updated at ${item.configPath}`);
          }
          if (item.cli === "gemini" && item.configured) {
            console.log(`Gemini settings updated at ${item.configPath}`);
          }
          if (item.cli === "opencode" && item.conflict) {
            console.log("OpenCode config 'plugin' is not an array. Please update ~/.config/opencode/opencode.json manually.");
          }
          if (item.cli === "opencode" && item.configured) {
            console.log(`OpenCode config updated at ${item.configPath}`);
          }
        });
      }
      break;
    }
    case "uninstall": {
      if (options.help || options.h) {
        console.log(`
  omp uninstall — Remove hooks and data

  USAGE
    omp uninstall [options]

  OPTIONS
    --cli <targets>    Comma-separated: claude,codex,opencode (default: auto-detect)
    --all              Full uninstall: remove hooks, config, and data
    --hooks-only       With --all: only remove hooks, keep config and data
    --remove-config    Remove config file (without --all)
    --yes, -y          Skip confirmation prompts
    --json             Output as JSON
`);
        break;
      }
      const removed = await handleUninstall(options);
      if (options.json) {
        printJson({ removed });
      } else if (!options.all) {
        removed.forEach((item) => console.log(`Removed ${item.cli} hook at ${item.path}`));
      }
      break;
    }
    case "status": {
      if (options.help || options.h) {
        console.log(`
  omp status — Show configuration and hook status

  USAGE
    omp status [options]

  OPTIONS
    --json    Output as JSON
`);
        break;
      }
      handleStatus(options);
      break;
    }
    case "stats": {
      if (options.help || options.h) {
        console.log(`
  omp stats — Show prompt statistics

  USAGE
    omp stats [options]

  OPTIONS
    --since <date>      Filter from date (YYYY-MM-DD)
    --until <date>      Filter to date (YYYY-MM-DD)
    --group-by <field>  Group by: day, project, source
    --json              Output as JSON
`);
        break;
      }
      handleStats(options);
      break;
    }
    case "export": {
      if (options.help || options.h) {
        console.log(`
  omp export — Export prompt records

  USAGE
    omp export [options]

  OPTIONS
    --format <fmt>   Output format: json, csv, jsonl (default: json)
    --since <date>   Filter from date (YYYY-MM-DD)
    --until <date>   Filter to date (YYYY-MM-DD)
    --out <path>     Write to file (default: stdout)
    --json           Output metadata as JSON
`);
        break;
      }
      handleExport(options);
      break;
    }
    case "sync": {
      if (positional[0] === "status") {
        if (options.help || options.h) {
          console.log(`
  omp sync status — Show sync checkpoint and recent runs

  USAGE
    omp sync status [options]

  OPTIONS
    --limit <n>   Number of recent entries (default: 5)
    --json        Output as JSON
`);
          break;
        }
        handleSyncStatus(options);
      } else if (positional[0] === "flush") {
        await handleSyncFlush(options);
      } else if (positional[0] === "auto") {
        if (options.help || options.h) {
          console.log(`
  omp sync auto — Background auto-sync daemon

  USAGE
    omp sync auto              Start auto-sync daemon
    omp sync auto stop         Stop auto-sync daemon
    omp sync auto status       Show auto-sync daemon status

  CONFIG
    sync.auto        boolean   Enable/disable auto-sync (default: false)
    sync.debounce    number    Debounce delay in seconds (default: 30)
    sync.interval    number    Max interval between syncs in seconds (default: 300)

  OPTIONS
    --json    Output as JSON
`);
          break;
        }
        handleSyncAuto(options, positional.slice(1));
      } else {
        if (options.help || options.h) {
          console.log(`
  omp sync — Upload local records to server

  USAGE
    omp sync [options]

  SUBCOMMANDS
    omp sync status    Show sync checkpoint and recent runs
    omp sync flush     Delete ALL server-side records (destructive)
    omp sync auto      Manage background auto-sync daemon

  OPTIONS
    --force            Override sync lock
    --dry-run          Show what would be uploaded
    --since <date>     Only sync records after date
    --chunk-size <n>   Records per request (default: 500)
    --lock-ttl <ms>    Lock timeout in ms
    --json             Output as JSON
`);
          break;
        }
        await handleSync(options);
      }
      break;
    }
    case "ingest": {
      if (options.help || options.h) {
        console.log(`
  omp ingest — Ingest a raw JSON payload (used by hooks)

  USAGE
    omp ingest [options]
    echo '{"prompt":"..."}' | omp ingest

  OPTIONS
    --replay     Replay queued payloads
    --stdin      Read from stdin
    --json       Output as JSON
`);
        break;
      }
      await handleIngest(options);
      break;
    }
    case "config": {
      if (options.help || options.h) {
        console.log(`
  omp config — Read and write configuration

  USAGE
    omp config get [key]        Read value (omit key for full dump)
    omp config set <key> <val>  Write value (dot-notation: server.url)
    omp config validate         Validate configuration

  OPTIONS
    --json    Output as JSON

  EXAMPLES
    omp config get server.url
    omp config set server.token abc123
    omp config validate
`);
        break;
      }
      handleConfig(options, positional);
      break;
    }
    case "import": {
      if (options.help || options.h) {
        console.log(`
  omp import — Import from external sources

  USAGE
    omp import codex-history [options]

  OPTIONS
    --path <file>   Custom history file path
    --dry-run       Show what would be imported
    --json          Output as JSON
`);
        break;
      }
      await handleImport(options, positional);
      break;
    }
    case "backfill": {
      if (options.help || options.h) {
        console.log(`
  omp backfill — Import from Claude transcripts and Codex history

  USAGE
    omp backfill [options]

  Scans ~/.claude/projects/ for JSONL transcripts and
  ~/.codex/history.jsonl for Codex prompts.

  OPTIONS
    --path <file>     Process a single transcript file (Claude only)
    --claude-only     Only backfill Claude Code transcripts
    --codex-only      Only backfill Codex history
    --dry-run         Show what would be imported without writing
    --json            Output as JSON
`);
        break;
      }
      const { backfillTranscripts, backfillCodex } = require("./backfill");
      const config = loadConfig();
      const dryRun = !!options["dry-run"];
      const claudeOnly = !!options["claude-only"];
      const codexOnly = !!options["codex-only"];

      let claudeResult = null;
      let codexResult = null;

      if (!codexOnly) {
        claudeResult = backfillTranscripts(config, {
          path: options.path,
          dryRun,
        });
      }
      if (!claudeOnly && !options.path) {
        codexResult = backfillCodex(config, { dryRun });
      }

      if (options.json) {
        printJson({ claude: claudeResult, codex: codexResult });
      } else {
        if (claudeResult) {
          console.log(`[Claude] Scanned ${claudeResult.files} transcript file(s)`);
          console.log(`[Claude] Imported: ${claudeResult.totalImported}, Skipped: ${claudeResult.totalSkipped}, Duplicates: ${claudeResult.totalDuplicates}`);
          for (const f of claudeResult.fileResults) {
            const name = path.basename(f.path, ".jsonl");
            const status = f.error ? ` (${f.error})` : "";
            console.log(`  ${name}: ${f.turns} turns, ${f.imported} imported, ${f.duplicates} deduped${status}`);
          }
        }
        if (codexResult) {
          console.log(`[Codex] Scanned ${codexResult.entries} history entries`);
          console.log(`[Codex] Imported: ${codexResult.imported}, Skipped: ${codexResult.skipped}, Duplicates: ${codexResult.duplicates}`);
        }
      }
      break;
    }
    case "db": {
      const action = positional[0];
      if (options.help || options.h || !action) {
        console.log(`
  omp db — Database management

  USAGE
    omp db <subcommand> [options]

  SUBCOMMANDS
    migrate    Run database migrations
    flush      Delete ALL local records and reset sync state

  OPTIONS
    --yes, -y   Skip confirmation (flush only)
    --json      Output as JSON
`);
        break;
      }
      if (action === "migrate") {
        const { migrateDatabase } = require("./migrate");
        const config = loadConfig();
        const result = migrateDatabase(config);
        if (options.json) {
          printJson(result);
        } else {
          console.log(`Schema version: ${result.version}`);
        }
        break;
      }
      if (action === "flush") {
        const config = loadConfig();
        if (!options.yes && !options.y) {
          console.log("This will delete ALL local records and reset sync state.");
          console.log("Run with --yes to confirm.");
          process.exitCode = 1;
          break;
        }
        const db = openDb(config.storage.sqlite.path);
        db.exec("DELETE FROM prompts");
        db.exec("DELETE FROM sync_log");
        db.exec("DELETE FROM sync_state");
        try { db.exec("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')"); } catch {}
        const remaining = db.prepare("SELECT count(*) as c FROM prompts").get();
        db.close();
        if (options.json) {
          printJson({ flushed: true, remaining: remaining.c });
        } else {
          console.log("Local database flushed. All records and sync state cleared.");
        }
        break;
      }
      console.error(`Unknown subcommand: omp db ${action}`);
      console.error("Run 'omp db --help' for available subcommands.");
      process.exitCode = 2;
      break;
    }
    case "doctor": {
      if (options.help || options.h) {
        console.log(`
  omp doctor — Diagnose common issues

  USAGE
    omp doctor [options]

  Checks hooks, config, database, and server connectivity.

  OPTIONS
    --json    Output as JSON
`);
        break;
      }
      const { runDoctor } = require("./doctor");
      const config = loadConfig();
      const report = runDoctor(config);
      if (options.json) {
        printJson(report);
      } else {
        if (report.ok) console.log(pass("Doctor: all checks passed"));
        if (report.errors.length) {
          console.log(c.red("\nErrors:"));
          report.errors.forEach((e) => console.log(fail(e)));
        }
        if (report.warnings.length) {
          console.log(c.yellow("\nWarnings:"));
          report.warnings.forEach((w) => console.log(warn(w)));
        }
      }
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case "serve": {
      const action = positional[0] || null;
      if (options.help || options.h) {
        console.log(`
  omp serve — Local dashboard server via Docker

  USAGE
    omp serve              Start local dashboard
    omp serve stop         Stop local dashboard
    omp serve status       Show container status
    omp serve logs         Tail app logs

  CONFIG
    omp config set serve.image <image>       Docker image (default: registry.jiun.dev/oh-my-prompt:latest)
    omp config set serve.port <port>         Local port (default: 3000)
    omp config set serve.adminEmail <email>  Auto-seeded admin email

  Requires Docker and Docker Compose.
`);
        break;
      }
      const { startServer, stopServer, showStatus, showLogs } = require("./serve");
      if (action === "stop") {
        stopServer();
      } else if (action === "status") {
        showStatus();
      } else if (action === "logs") {
        showLogs(options.follow || options.f);
      } else if (!action) {
        const config = loadConfig();
        await startServer(config);
      } else {
        console.error(`Unknown subcommand: omp serve ${action}`);
        process.exitCode = 2;
      }
      break;
    }
    case "ask": {
      if (options.help || options.h) {
        console.log(`
  omp ask — Ask a question about your prompts

  USAGE
    omp ask "your question" [options]

  The question is sent to the server's AI-powered insights endpoint,
  which analyzes your prompt history and returns an answer.

  OPTIONS
    --json    Output as JSON

  EXAMPLES
    omp ask "What projects did I work on this week?"
    omp ask "How many prompts did I send yesterday?"
    omp ask "What are my most active sessions?" --json
`);
        break;
      }
      await handleAsk(options, positional);
      break;
    }
    case "analyze": {
      if (options.help || options.h) {
        console.log(`
  omp analyze — Analyze a specific prompt

  USAGE
    omp analyze [prompt-id] [options]

  Shows prompt text, metadata, and quality score breakdown.
  If no ID is given, analyzes the most recent prompt.

  OPTIONS
    --json    Output as JSON

  EXAMPLES
    omp analyze
    omp analyze abc123-def456
    omp analyze --json
`);
        break;
      }
      handleAnalyze(options, positional);
      break;
    }
    case "report": {
      if (options.help || options.h) {
        console.log(`
  omp report — Generate a summary report

  USAGE
    omp report [options]

  Shows total prompts, tokens, projects, top sessions, quality trends.

  OPTIONS
    --since <date>    Filter from date (YYYY-MM-DD)
    --until <date>    Filter to date (YYYY-MM-DD)
    --format <fmt>    Output format: text, json (default: text)
    --json            Alias for --format json

  EXAMPLES
    omp report
    omp report --since 2025-01-01
    omp report --since 2025-01-01 --until 2025-06-30 --json
`);
        break;
      }
      handleReport(options);
      break;
    }
    default:
      console.error(fail(`Unknown command: ${c.bold(command)}`));
      console.error(c.dim("Run 'omp --help' for available commands."));
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

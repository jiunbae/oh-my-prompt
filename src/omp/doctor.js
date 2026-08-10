const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const os = require("os");
const {
  openDb,
  getCurrentVersion,
  LATEST_MIGRATION_VERSION,
} = require("./db");
const { getConfigPath, getConfigDir } = require("./paths");
const { getQueueStats } = require("./queue");
const { listHookStatus } = require("./hooks");
const { getSyncStatus } = require("./sync-log");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getJson(url, headers, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { ...headers },
      timeout: timeoutMs,
      family: 4,
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json });
        } catch {
          resolve({ status: res.statusCode, body: null, parseError: true });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.storage.sqlite?.path) {
    errors.push("storage.sqlite.path is required");
  }

  if (config.queue?.maxBytes !== undefined && Number(config.queue.maxBytes) <= 0) {
    errors.push("queue.maxBytes must be > 0");
  }

  // Server sync config
  if (config.server?.url && config.server?.token) {
    // Server sync configured - good
  } else if (config.server?.url && !config.server?.token) {
    errors.push("server.url is set but server.token is missing");
  } else if (!config.server?.url && config.server?.token) {
    warnings.push("server.token is set but server.url is missing");
  } else {
    warnings.push("No sync configured. Set server.url and server.token for cloud sync.");
  }

  if (!config.server?.deviceId && !config.sync?.deviceId) {
    warnings.push("No deviceId configured (defaults to hostname)");
  }

  // Validate sync timing config
  try {
    const { validateTimingConfig } = require("./auto-sync");
    const timing = validateTimingConfig(config.sync?.debounce, config.sync?.interval);
    errors.push(...timing.errors);
  } catch {
    // auto-sync module not available, skip timing validation
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkConfigFile(report) {
  const configPath = getConfigPath();
  const result = { path: configPath, exists: false, valid: false };

  try {
    if (!fs.existsSync(configPath)) {
      result.exists = false;
      report.checks.config = result;
      // Not an error — defaults are used — but worth noting
      report.warnings.push("Config file does not exist; using defaults");
      return;
    }

    result.exists = true;
    const stat = fs.statSync(configPath);
    result.size = stat.size;

    // Attempt to parse
    const raw = fs.readFileSync(configPath, "utf-8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      result.valid = false;
      result.parseError = parseErr.message;
      report.errors.push(`config: invalid JSON — ${parseErr.message}`);
      report.checks.config = result;
      return;
    }

    result.valid = true;

    // Check for common misconfigurations
    if (parsed.storage?.sqlite?.path) {
      const dbDir = path.dirname(parsed.storage.sqlite.path);
      if (!fs.existsSync(dbDir)) {
        report.warnings.push(
          `config: DB directory does not exist: ${dbDir}`
        );
      }
    }

    // Warn on overly permissive file permissions (Unix only)
    if (os.platform() !== "win32") {
      const mode = (stat.mode & 0o777).toString(8);
      if (mode !== "600" && mode !== "640" && mode !== "644") {
        // Only warn if world-readable and token is set
        if ((stat.mode & 0o004) && parsed.server?.token) {
          report.warnings.push(
            `config: file is world-readable (${mode}) and contains a server token; consider chmod 600`
          );
        }
      }
    }
  } catch (error) {
    report.errors.push(`config: ${error.message}`);
  }

  report.checks.config = result;
}

async function checkServer(report, config) {
  const serverUrl = config.server?.url;
  const serverToken = config.server?.token;

  const result = { configured: !!(serverUrl && serverToken) };

  if (!result.configured) {
    if (!serverUrl && !serverToken) {
      result.status = "not_configured";
    } else {
      result.status = "misconfigured";
    }
    report.checks.server = result;
    return;
  }

  result.url = serverUrl;

  try {
    const start = Date.now();
    const resp = await getJson(
      `${serverUrl.replace(/\/$/, "")}/api/auth/me`,
      { "X-User-Token": serverToken },
      10000
    );
    result.latencyMs = Date.now() - start;

    if (resp.status === 200) {
      result.status = "connected";
      if (resp.body?.user) {
        result.user = resp.body.user;
      }
      if (resp.body?.version) {
        result.serverVersion = resp.body.version;
      }
    } else if (resp.status === 401 || resp.status === 403) {
      result.status = "auth_failed";
      report.errors.push(
        `server: authentication failed (HTTP ${resp.status}). Check server.token.`
      );
    } else {
      result.status = "error";
      result.httpStatus = resp.status;
      report.errors.push(`server: unexpected HTTP ${resp.status}`);
    }
  } catch (error) {
    if (error.message === "Request timed out") {
      result.status = "timeout";
      report.errors.push("server: connection timed out (10s)");
    } else if (error.code === "ECONNREFUSED") {
      result.status = "refused";
      report.errors.push(`server: connection refused at ${serverUrl}`);
    } else {
      result.status = "error";
      result.error = error.message;
      report.errors.push(`server: ${error.message}`);
    }
  }

  report.checks.server = result;
}

async function checkDatabase(report, config) {
  const dbPath = config.storage.sqlite?.path;
  const result = { path: dbPath };

  if (!dbPath) {
    result.status = "no_path";
    report.errors.push("db: storage.sqlite.path is not configured");
    report.checks.database = result;
    return;
  }

  // File existence and size
  if (fs.existsSync(dbPath)) {
    try {
      const stat = fs.statSync(dbPath);
      result.fileSize = stat.size;
      result.fileSizeFormatted = formatBytes(stat.size);
    } catch {
      // stat may fail on permission issues
    }
  } else {
    result.fileExists = false;
    result.status = "new";
    report.checks.database = result;
    // New DB is not an error — openDb will create it
    return;
  }
  result.fileExists = true;

  let db;
  try {
    db = await openDb(dbPath);
  } catch (error) {
    result.status = "open_error";
    report.errors.push(`db: failed to open — ${error.message}`);
    report.checks.database = result;
    return;
  }

  try {
    // Check expected tables
    const expectedTables = ["prompts", "tags", "prompt_tags", "prompt_reviews", "sync_log", "sync_state"];
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    result.tables = tables;

    const missing = expectedTables.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      result.missingTables = missing;
      report.warnings.push(`db: missing tables: ${missing.join(", ")}`);
    }

    // Row counts
    if (tables.includes("prompts")) {
      const countRow = db.prepare("SELECT COUNT(*) AS count FROM prompts").get();
      result.promptCount = countRow ? countRow.count : 0;
    }
    if (tables.includes("tags")) {
      const tagRow = db.prepare("SELECT COUNT(*) AS count FROM tags").get();
      result.tagCount = tagRow ? tagRow.count : 0;
    }
    if (tables.includes("prompt_tags")) {
      const ptRow = db.prepare("SELECT COUNT(*) AS count FROM prompt_tags").get();
      result.promptTagCount = ptRow ? ptRow.count : 0;
    }

    // Integrity check (sql.js supports PRAGMA integrity_check)
    try {
      const integrityRows = db.pragma("integrity_check");
      if (integrityRows && integrityRows.length > 0) {
        const first = integrityRows[0];
        if (first.integrity_check === "ok") {
          result.integrity = "ok";
        } else {
          result.integrity = "error";
          result.integrityDetail = integrityRows.map((r) => r.integrity_check);
          report.errors.push(
            `db: integrity check failed — ${result.integrityDetail.slice(0, 3).join("; ")}`
          );
        }
      } else {
        // pragma returned no rows — try a lightweight sanity query
        db.prepare("SELECT 1 FROM prompts LIMIT 1").get();
        result.integrity = "ok_lightweight";
      }
    } catch (integErr) {
      // Some sql.js builds may not support integrity_check
      result.integrity = "unsupported";
      result.integrityError = integErr.message;
    }

    // Check indexes
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    result.indexes = indexes;

    result.status = "ok";
  } catch (error) {
    result.status = "query_error";
    report.errors.push(`db: health check query failed — ${error.message}`);
  } finally {
    db.close();
  }

  report.checks.database = result;
}

function checkDiskSpace(report, config) {
  const targetDir = getConfigDir();
  const result = { dir: targetDir };

  try {
    if (!fs.existsSync(targetDir)) {
      result.status = "dir_missing";
      report.checks.disk = result;
      return;
    }

    // Node 18+ has fs.statfsSync
    if (typeof fs.statfsSync === "function") {
      const stats = fs.statfsSync(targetDir);
      result.blockSize = stats.bsize;
      result.totalBlocks = stats.blocks;
      result.freeBlocks = stats.bfree;
      result.availableBlocks = stats.bavail;
      result.totalBytes = stats.blocks * stats.bsize;
      result.availableBytes = stats.bavail * stats.bsize;
      result.totalFormatted = formatBytes(result.totalBytes);
      result.availableFormatted = formatBytes(result.availableBytes);
      result.status = "ok";

      const availableMB = result.availableBytes / (1024 * 1024);
      if (availableMB < 100) {
        result.status = "low";
        report.warnings.push(
          `disk: low disk space — ${result.availableFormatted} available in ${targetDir}`
        );
      }
    } else {
      // Fallback: skip detailed check
      result.status = "skipped";
      result.reason = "fs.statfsSync not available (requires Node 18+)";
    }
  } catch (error) {
    result.status = "error";
    result.error = error.message;
    report.warnings.push(`disk: could not check disk space — ${error.message}`);
  }

  report.checks.disk = result;
}

async function checkMigrations(report, config) {
  const dbPath = config.storage.sqlite?.path;
  const result = {};

  if (!dbPath) {
    result.status = "no_path";
    report.checks.migrations = result;
    return;
  }

  if (!fs.existsSync(dbPath)) {
    result.status = "new_db";
    result.pending = LATEST_MIGRATION_VERSION;
    result.currentVersion = 0;
    result.latestVersion = LATEST_MIGRATION_VERSION;
    report.checks.migrations = result;
    return;
  }

  let db;
  try {
    db = await openDb(dbPath);
  } catch (error) {
    result.status = "open_error";
    result.error = error.message;
    report.checks.migrations = result;
    return;
  }

  try {
    const currentVersion = getCurrentVersion(db);
    const pending = LATEST_MIGRATION_VERSION - currentVersion;

    result.currentVersion = currentVersion;
    result.latestVersion = LATEST_MIGRATION_VERSION;
    result.pending = pending;

    if (pending > 0) {
      result.status = "pending";
      report.warnings.push(
        `migrations: ${pending} pending migration(s) (v${currentVersion} -> v${LATEST_MIGRATION_VERSION}). Run 'omp db migrate'.`
      );
    } else {
      result.status = "up_to_date";
    }
  } catch (error) {
    result.status = "error";
    result.error = error.message;
    report.warnings.push(`migrations: could not check version — ${error.message}`);
  } finally {
    db.close();
  }

  report.checks.migrations = result;
}

// ---------------------------------------------------------------------------
// Main doctor runner
// ---------------------------------------------------------------------------

async function runDoctor(config) {
  const report = {
    ok: true,
    errors: [],
    warnings: [],
    checks: {},
  };

  // 1. Config validation (existing logic)
  const validation = validateConfig(config);
  report.errors.push(...validation.errors);
  report.warnings.push(...validation.warnings);

  // 2. Config file check
  await checkConfigFile(report);

  // 3. Database health check (replaces simple DB open)
  await checkDatabase(report, config);

  // 4. Migration check
  await checkMigrations(report, config);

  // 5. Queue stats
  const queueStats = getQueueStats();
  report.checks.queue = queueStats;
  if (queueStats.count > 0) {
    report.warnings.push("queue has pending items; run 'omp ingest --replay'");
  }

  // 6. Hooks
  const hooks = listHookStatus();
  report.checks.hooks = hooks;
  if (config.hooks?.enabled?.claude_code && !hooks.claude_code) {
    report.warnings.push("Claude hook enabled in config but not installed");
  }
  if (config.hooks?.enabled?.codex && !hooks.codex) {
    report.warnings.push("Codex hook enabled in config but not installed");
  }
  if (config.hooks?.enabled?.opencode && !hooks.opencode) {
    report.warnings.push("OpenCode hook enabled in config but not installed");
  }

  // 7. Server connectivity check
  await checkServer(report, config);

  // 8. Disk space check
  checkDiskSpace(report, config);

  // 9. Sync status
  try {
    report.checks.sync = await getSyncStatus(config, 1);
  } catch {
    report.warnings.push("sync status unavailable");
  }

  // 10. Auto-sync daemon status
  try {
    const { isDaemonRunning, getLastSyncTime } = require("./auto-sync");
    const daemonState = isDaemonRunning();
    const lastSync = getLastSyncTime();

    report.checks.autoSync = {
      enabled: !!config.sync?.auto,
      running: daemonState.running,
      pid: daemonState.pid,
      lastSyncTime: lastSync,
    };

    if (config.sync?.auto && !daemonState.running) {
      report.warnings.push(
        "Auto-sync is enabled but daemon is not running. Start with: omp sync auto"
      );
    }
  } catch {
    // auto-sync module not available, skip
  }

  report.ok = report.errors.length === 0;
  return report;
}

module.exports = {
  validateConfig,
  runDoctor,
};

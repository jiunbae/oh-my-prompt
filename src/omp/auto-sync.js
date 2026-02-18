const fs = require("fs");
const path = require("path");
const { getConfigDir, ensureDir } = require("./paths");

const TRIGGER_FILE = path.join(getConfigDir(), "sync-trigger");
const PID_FILE = path.join(getConfigDir(), "sync-daemon.pid");
const LOG_FILE = path.join(getConfigDir(), "sync-daemon.log");

const DEFAULT_DEBOUNCE_S = 30;
const DEFAULT_INTERVAL_S = 300;

function appendLog(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  try {
    ensureDir(path.dirname(LOG_FILE));
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // ignore log write failures
  }
}

function readPid() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(raw, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid) {
  ensureDir(path.dirname(PID_FILE));
  fs.writeFileSync(PID_FILE, String(pid), { mode: 0o600 });
}

function removePid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isDaemonRunning() {
  const pid = readPid();
  if (!pid) return { running: false, pid: null };
  if (isProcessAlive(pid)) return { running: true, pid };
  // Stale PID file - clean up
  removePid();
  return { running: false, pid: null };
}

function getLastSyncTime() {
  try {
    if (!fs.existsSync(LOG_FILE)) return null;
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Walk backward to find the last sync result line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.includes("sync completed") || line.includes("sync failed")) {
        const match = line.match(/^\[([^\]]+)\]/);
        return match ? match[1] : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function touchTrigger() {
  try {
    ensureDir(path.dirname(TRIGGER_FILE));
    fs.writeFileSync(TRIGGER_FILE, Date.now().toString());
  } catch {
    // ignore trigger write failures
  }
}

/**
 * Run the daemon loop in the current process.
 * This is called by the detached child process.
 */
function runDaemonLoop(configPath) {
  const { loadConfig } = require("./config");
  const { syncToServer } = require("./sync");
  const { acquireSyncLock, releaseSyncLock } = require("./sync-lock");

  // Override config path if provided
  if (configPath) {
    process.env.OMP_CONFIG_PATH = configPath;
  }

  const config = loadConfig();
  const debounceMs = (config.sync?.debounce || DEFAULT_DEBOUNCE_S) * 1000;
  const intervalMs = (config.sync?.interval || DEFAULT_INTERVAL_S) * 1000;

  writePid(process.pid);
  appendLog("daemon started (pid=" + process.pid + ", debounce=" + (debounceMs / 1000) + "s, interval=" + (intervalMs / 1000) + "s)");

  let debounceTimer = null;
  let intervalTimer = null;
  let syncing = false;
  let lastTriggerMtime = 0;

  async function doSync() {
    if (syncing) return;
    syncing = true;

    // Reload config each time in case it changed
    let currentConfig;
    try {
      currentConfig = loadConfig();
    } catch {
      currentConfig = config;
    }

    const lock = acquireSyncLock({ ttlMs: 60000 });
    if (!lock.ok) {
      appendLog("sync skipped: lock held by another process");
      syncing = false;
      return;
    }

    try {
      const result = await syncToServer(currentConfig);
      appendLog(
        "sync completed: uploaded=" + result.uploaded +
        " duplicates=" + (result.duplicates || 0) +
        " chunks=" + result.chunks
      );
    } catch (err) {
      appendLog("sync failed: " + (err.message || "unknown error"));
    } finally {
      releaseSyncLock(lock.lockPath);
      syncing = false;
    }
  }

  function scheduleDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doSync();
    }, debounceMs);
  }

  // Poll the trigger file for changes
  const pollInterval = setInterval(() => {
    try {
      if (!fs.existsSync(TRIGGER_FILE)) return;
      const stat = fs.statSync(TRIGGER_FILE);
      const mtime = stat.mtimeMs;
      if (mtime > lastTriggerMtime) {
        lastTriggerMtime = mtime;
        scheduleDebounce();
      }
    } catch {
      // ignore poll errors
    }
  }, 2000);

  // Max interval timer: sync at least every `interval` seconds
  intervalTimer = setInterval(() => {
    if (!syncing) {
      appendLog("interval sync triggered");
      doSync();
    }
  }, intervalMs);

  // Graceful shutdown
  function shutdown(signal) {
    appendLog("daemon stopping (" + signal + ")");
    if (debounceTimer) clearTimeout(debounceTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    clearInterval(pollInterval);
    removePid();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Keep the event loop alive
  process.stdin.resume();
}

function startDaemon(config) {
  const status = isDaemonRunning();
  if (status.running) {
    return { started: false, alreadyRunning: true, pid: status.pid };
  }

  const { getConfigPath } = require("./paths");
  const configPath = getConfigPath();

  // Fork a detached child that runs the daemon loop
  const { fork } = require("child_process");
  const daemonScript = path.join(__dirname, "auto-sync-daemon.js");

  // Write the daemon entry script if it doesn't exist
  ensureDir(path.dirname(daemonScript));
  fs.writeFileSync(
    daemonScript,
    'require("./auto-sync").runDaemonLoop(process.argv[2]);\n'
  );

  const child = fork(daemonScript, [configPath], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  // Give the child a moment to write its PID
  // We return the child PID immediately since the daemon writes it on startup
  return { started: true, alreadyRunning: false, pid: child.pid };
}

function stopDaemon() {
  const status = isDaemonRunning();
  if (!status.running) {
    return { stopped: false, wasRunning: false };
  }

  try {
    process.kill(status.pid, "SIGTERM");
  } catch {
    // process may have already exited
  }

  removePid();
  return { stopped: true, wasRunning: true, pid: status.pid };
}

function daemonStatus() {
  const status = isDaemonRunning();
  const lastSync = getLastSyncTime();
  return {
    running: status.running,
    pid: status.pid,
    lastSyncTime: lastSync,
    pidFile: PID_FILE,
    logFile: LOG_FILE,
    triggerFile: TRIGGER_FILE,
  };
}

module.exports = {
  startDaemon,
  stopDaemon,
  daemonStatus,
  isDaemonRunning,
  touchTrigger,
  runDaemonLoop,
  TRIGGER_FILE,
  PID_FILE,
  LOG_FILE,
};

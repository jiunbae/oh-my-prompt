const { lowerBackgroundPriority } = require("./resource-priority");

const HEARTBEAT_INTERVAL_MS = 30000;

function sendHeartbeat(progress = null) {
  if (!process.send || !process.connected) return;
  try {
    process.send({ type: "heartbeat", at: Date.now(), progress });
  } catch {
    // Parent may have exited while the worker was finishing.
  }
}

async function runSyncOnce(configPath) {
  if (configPath) process.env.OMP_CONFIG_PATH = configPath;
  process.title = "omp-sync-worker";
  lowerBackgroundPriority();

  const { loadConfig } = require("./config");
  const { syncToServer } = require("./sync");
  const { acquireSyncLock, releaseSyncLock, refreshSyncLock } = require("./sync-lock");
  const lock = acquireSyncLock({ ttlMs: 60000 });
  if (!lock.ok) {
    const error = new Error("sync lock held by another process");
    error.code = "OMP_SYNC_LOCKED";
    throw error;
  }

  try {
    try {
      if (process.send && process.connected) {
        process.send({ type: "lock", lockPath: lock.lockPath, lockInfo: lock.lockInfo });
      }
    } catch {
      // The parent may have exited between the connection check and send.
    }
    const heartbeatNow = (progress = null) => {
      if (!refreshSyncLock(lock.lockPath, lock.lockInfo)) {
        const error = new Error("sync lock ownership was lost");
        error.code = "OMP_SYNC_LOCK_LOST";
        throw error;
      }
      sendHeartbeat(progress);
    };
    heartbeatNow();
    const heartbeat = setInterval(() => {
      try {
        heartbeatNow();
      } catch {
        // Continuing an upload after losing its lease could create concurrent
        // sync workers. SQLite transactions and server event IDs make a hard
        // worker exit safer; the parent will retry with bounded backoff.
        process.exit(1);
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      return await syncToServer(loadConfig(), {
        onProgress: (progress) => heartbeatNow(progress),
      });
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    releaseSyncLock(lock.lockPath, { owner: lock.lockInfo });
  }
}

function sendResult(payload) {
  if (!process.send || !process.connected) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      process.send(payload, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function main() {
  try {
    const result = await runSyncOnce(process.argv[2]);
    await sendResult({ type: "result", ok: true, result });
  } catch (error) {
    await sendResult({
      type: "result",
      ok: false,
      code: error.code || null,
      error: error.message || "unknown error",
    });
    process.exitCode = error.code === "OMP_SYNC_LOCKED" ? 75 : 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { runSyncOnce };

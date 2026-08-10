const { lowerBackgroundPriority } = require("./resource-priority");

async function runSyncOnce(configPath) {
  if (configPath) process.env.OMP_CONFIG_PATH = configPath;
  process.title = "omp-sync-worker";
  lowerBackgroundPriority();

  const { loadConfig } = require("./config");
  const { syncToServer } = require("./sync");
  const { acquireSyncLock, releaseSyncLock } = require("./sync-lock");
  const lock = acquireSyncLock({ ttlMs: 60000 });
  if (!lock.ok) {
    const error = new Error("sync lock held by another process");
    error.code = "OMP_SYNC_LOCKED";
    throw error;
  }

  try {
    try {
      if (process.send && process.connected) {
        process.send({ type: "lock", lockPath: lock.lockPath });
      }
    } catch {
      // The parent may have exited between the connection check and send.
    }
    return await syncToServer(loadConfig());
  } finally {
    releaseSyncLock(lock.lockPath);
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

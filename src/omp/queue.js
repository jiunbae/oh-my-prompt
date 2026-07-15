const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getQueueDir, ensureDir } = require("./paths");

const QUEUE_LOCK_TIMEOUT_MS = 2_000;
const QUEUE_LOCK_STALE_MS = 30_000;
const QUEUE_SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function acquireQueueLock(queueDir) {
  const lockPath = path.join(queueDir, ".queue.lock");
  const deadline = Date.now() + QUEUE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.closeSync(fd);
      return lockPath;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > QUEUE_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the local ingest queue lock");
      }
      Atomics.wait(QUEUE_SLEEP_BUFFER, 0, 0, 25);
    }
  }
}

function getQueueStats() {
  const queueDir = getQueueDir();
  if (!fs.existsSync(queueDir)) {
    return { count: 0, bytes: 0, oldest: null, newest: null };
  }

  const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".jsonl"));
  let bytes = 0;
  let oldest = null;
  let newest = null;

  for (const file of files) {
    const filepath = path.join(queueDir, file);
    let stats;
    try {
      stats = fs.statSync(filepath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    bytes += stats.size;
    if (!oldest || stats.mtimeMs < oldest.mtimeMs) {
      oldest = { file, mtimeMs: stats.mtimeMs };
    }
    if (!newest || stats.mtimeMs > newest.mtimeMs) {
      newest = { file, mtimeMs: stats.mtimeMs };
    }
  }

  return {
    count: files.length,
    bytes,
    oldest: oldest ? oldest.file : null,
    newest: newest ? newest.file : null,
  };
}

function enforceQueueLimitUnlocked(maxBytes) {
  if (!maxBytes) return getQueueStats();

  const queueDir = getQueueDir();
  if (!fs.existsSync(queueDir)) {
    return { count: 0, bytes: 0, oldest: null, newest: null };
  }

  let stats = getQueueStats();
  if (stats.bytes <= maxBytes) return stats;

  const files = fs
    .readdirSync(queueDir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((file) => {
      const filepath = path.join(queueDir, file);
      try {
        const fileStats = fs.statSync(filepath);
        return [{ file, filepath, mtimeMs: fileStats.mtimeMs, size: fileStats.size }];
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const file of files) {
    if (stats.bytes <= maxBytes) break;
    try {
      fs.unlinkSync(file.filepath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    stats.bytes -= file.size;
    stats.count -= 1;
  }

  return getQueueStats();
}

function enforceQueueLimit(maxBytes) {
  const queueDir = getQueueDir();
  ensureDir(queueDir);
  const lockPath = acquireQueueLock(queueDir);
  try {
    return enforceQueueLimitUnlocked(maxBytes);
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function enqueuePayload(rawPayload, maxBytes) {
  const queueDir = getQueueDir();
  ensureDir(queueDir);
  const lockPath = acquireQueueLock(queueDir);
  try {
    const filename = `ingest-${Date.now()}-${process.pid}-${crypto.randomUUID()}.jsonl`;
    const filepath = path.join(queueDir, filename);
    fs.writeFileSync(filepath, rawPayload + "\n", { flag: "wx", mode: 0o600 });
    fs.chmodSync(filepath, 0o600);
    enforceQueueLimitUnlocked(maxBytes);
    return filepath;
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

module.exports = {
  getQueueStats,
  enforceQueueLimit,
  enqueuePayload,
};

const fs = require("fs");
const path = require("path");
const os = require("os");
const { getConfigDir, ensureDir } = require("./paths");

function getLockPath() {
  return path.join(getConfigDir(), "sync.lock");
}

function readLock(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  } catch (error) {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getLockAgeMs(lockInfo, lockPath) {
  const createdAt = lockInfo?.createdAt;
  if (createdAt) {
    const created = Date.parse(createdAt);
    if (!Number.isNaN(created)) {
      return Math.max(0, Date.now() - created);
    }
  }
  try {
    const stat = fs.statSync(lockPath);
    return Math.max(0, Date.now() - stat.mtimeMs);
  } catch (error) {
    return null;
  }
}

function isStale(lockInfo, lockPath, ttlMs) {
  if (!lockInfo) return true;
  const ageMs = getLockAgeMs(lockInfo, lockPath);
  if (ageMs === null) return true;
  return ageMs > ttlMs;
}

function tryCreateLock(lockPath) {
  const payload = {
    pid: process.pid,
    host: os.hostname(),
    createdAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: "wx" });
    return { created: true, payload };
  } catch (error) {
    if (error.code === "EEXIST") {
      return { created: false, payload: null };
    }
    throw error;
  }
}

function acquireSyncLock(options = {}) {
  const lockPath = getLockPath();
  ensureDir(path.dirname(lockPath));
  const ttlMs = options.ttlMs || 15 * 60 * 1000;

  const firstAttempt = tryCreateLock(lockPath);
  if (firstAttempt.created) {
    return { ok: true, lockPath, lockInfo: firstAttempt.payload };
  }

  const lockInfo = readLock(lockPath);
  const stale = isStale(lockInfo, lockPath, ttlMs);
  const sameHost = lockInfo?.host === os.hostname();
  const alive = sameHost ? isProcessAlive(lockInfo?.pid) : null;
  const orphaned = sameHost && lockInfo?.pid && !alive;

  if (options.force || stale || orphaned) {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    const secondAttempt = tryCreateLock(lockPath);
    if (secondAttempt.created) {
      return { ok: true, lockPath, lockInfo: secondAttempt.payload };
    }
  }

  return { ok: false, lockPath, lockInfo };
}

function releaseSyncLock(lockPath, options = {}) {
  if (!lockPath || !fs.existsSync(lockPath)) return;
  if (options.force) {
    fs.unlinkSync(lockPath);
    return;
  }
  const lockInfo = readLock(lockPath);
  const sameOwner =
    lockInfo?.pid === process.pid && lockInfo?.host === os.hostname();
  if (sameOwner) {
    fs.unlinkSync(lockPath);
  }
}

module.exports = {
  acquireSyncLock,
  releaseSyncLock,
};

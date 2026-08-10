const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { getConfigDir, ensureDir } = require("./paths");

function getLockPath(name) {
  return path.join(getConfigDir(), name || "sync.lock");
}

function readLock(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
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

function getLockAgeMs(lockInfo, lockPath) {
  let lastActivity = null;
  const createdAt = lockInfo?.createdAt;
  if (createdAt) {
    const created = Date.parse(createdAt);
    if (!Number.isNaN(created)) {
      lastActivity = created;
    }
  }
  try {
    const stat = fs.statSync(lockPath);
    // Ignore a materially future mtime (clock-skewed shared filesystems and
    // fake-timer tests alike); otherwise a lock could remain fresh forever.
    if (stat.mtimeMs <= Date.now() + 1000) {
      lastActivity = Math.max(lastActivity ?? 0, stat.mtimeMs);
    }
  } catch {
    if (lastActivity === null) return null;
  }
  return Math.max(0, Date.now() - lastActivity);
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
    nonce: crypto.randomUUID(),
  };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
    return { created: true, payload };
  } catch (error) {
    if (error.code === "EEXIST") {
      return { created: false, payload: null };
    }
    throw error;
  }
}

function acquireSyncLock(options = {}) {
  // A distinct `name` yields an independent advisory lock (e.g. "ingest.lock"),
  // so unrelated subsystems don't contend on the same file.
  const lockPath = getLockPath(options.name);
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

  // A long-running operation on this host remains authoritative even after its
  // TTL. TTL recovery is only for remote/unverifiable or dead owners.
  const staleAndNotAliveHere = stale && !(sameHost && alive);
  if (options.force || staleAndNotAliveHere || orphaned) {
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
  if (options.owner) {
    const expected = options.owner;
    const sameOwner = expected.nonce
      ? lockInfo?.nonce === expected.nonce
      : lockInfo?.pid === expected.pid &&
        lockInfo?.host === expected.host &&
        lockInfo?.createdAt === expected.createdAt;
    if (sameOwner) fs.unlinkSync(lockPath);
    return;
  }
  const sameOwner =
    lockInfo?.pid === process.pid && lockInfo?.host === os.hostname();
  if (sameOwner) {
    fs.unlinkSync(lockPath);
  }
}

function refreshSyncLock(lockPath, owner) {
  try {
    if (!lockPath || !owner || !fs.existsSync(lockPath)) return false;
    const current = readLock(lockPath);
    const sameOwner = owner.nonce
      ? current?.nonce === owner.nonce
      : current?.pid === owner.pid &&
        current?.host === owner.host &&
        current?.createdAt === owner.createdAt;
    if (!sameOwner) return false;
    const now = new Date();
    fs.utimesSync(lockPath, now, now);
    return true;
  } catch {
    // The file may be replaced between the owner check and utimes. Treat that
    // as lease loss instead of refreshing or deleting another owner's lock.
    return false;
  }
}

module.exports = {
  acquireSyncLock,
  releaseSyncLock,
  refreshSyncLock,
  readLock,
};

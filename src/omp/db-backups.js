const fs = require("fs");
const path = require("path");

function classifyBackup(baseName, fileName) {
  if (fileName === `${baseName}.pre-native.bak`) return "native-transition";
  if (fileName.startsWith(`${baseName}.pre-`) && fileName.endsWith(".bak")) return "manual-backup";
  if (fileName.startsWith(`${baseName}.stale-`)) return "stale-database";
  if (fileName === `${baseName}.corrupted`) return "corrupted-database";
  if (fileName.startsWith(`${baseName}.malformed-`)) return "malformed-database";
  return null;
}

function listDatabaseBackups(dbPath) {
  const directory = path.dirname(dbPath);
  const baseName = path.basename(dbPath);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const kind = classifyBackup(baseName, entry.name);
      if (!kind) return null;
      const backupPath = path.join(directory, entry.name);
      const stat = fs.statSync(backupPath);
      return {
        name: entry.name,
        path: backupPath,
        kind,
        protected: kind === "native-transition",
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ageDays: Math.max(0, (Date.now() - stat.mtimeMs) / (24 * 60 * 60 * 1000)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
}

function summarizeDatabaseBackups(dbPath) {
  const files = listDatabaseBackups(dbPath);
  return {
    count: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    protectedCount: files.filter((file) => file.protected).length,
    files,
  };
}

function pruneDatabaseBackups(dbPath, options = {}) {
  const olderThanDays = Number(options.olderThanDays ?? 30);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error("olderThanDays must be a finite number >= 0");
  }

  const candidates = listDatabaseBackups(dbPath).filter((file) => {
    if (file.protected && !options.includeTransition) return false;
    return file.ageDays >= olderThanDays;
  });
  if (!options.execute) {
    return {
      executed: false,
      olderThanDays,
      includeTransition: Boolean(options.includeTransition),
      deleted: [],
      candidates,
      bytesReclaimable: candidates.reduce((sum, file) => sum + file.size, 0),
    };
  }

  const deleted = [];
  for (const file of candidates) {
    // Every target is resolved from an exact directory entry classified above;
    // no user-provided glob or recursive deletion is involved.
    fs.unlinkSync(file.path);
    deleted.push(file);
  }
  return {
    executed: true,
    olderThanDays,
    includeTransition: Boolean(options.includeTransition),
    deleted,
    candidates,
    bytesReclaimed: deleted.reduce((sum, file) => sum + file.size, 0),
  };
}

module.exports = {
  classifyBackup,
  listDatabaseBackups,
  summarizeDatabaseBackups,
  pruneDatabaseBackups,
};

const fs = require("fs");
const path = require("path");
const { getQueueDir, ensureDir } = require("./paths");

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
    const stats = fs.statSync(filepath);
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

function enforceQueueLimit(maxBytes) {
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
    .map((file) => {
      const filepath = path.join(queueDir, file);
      const fileStats = fs.statSync(filepath);
      return { file, filepath, mtimeMs: fileStats.mtimeMs, size: fileStats.size };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const file of files) {
    if (stats.bytes <= maxBytes) break;
    fs.unlinkSync(file.filepath);
    stats.bytes -= file.size;
    stats.count -= 1;
  }

  return getQueueStats();
}

function enqueuePayload(rawPayload, maxBytes) {
  const queueDir = getQueueDir();
  ensureDir(queueDir);
  enforceQueueLimit(maxBytes);
  const filename = `ingest-${Date.now()}-${Math.floor(Math.random() * 10000)}.jsonl`;
  const filepath = path.join(queueDir, filename);
  fs.writeFileSync(filepath, rawPayload + "\n");
  enforceQueueLimit(maxBytes);
  return filepath;
}

module.exports = {
  getQueueStats,
  enforceQueueLimit,
  enqueuePayload,
};

const crypto = require("crypto");
const os = require("os");
const { openDb, nowIso } = require("./db");

function getDeviceId(config) {
  return config.server?.deviceId || config.sync?.deviceId || os.hostname();
}

function getUserToken(config) {
  return config.server?.token || config.sync?.userToken || "default";
}

async function createSyncLog(config, checkpoint, storageTypeOverride) {
  const db = await openDb(config.storage.sqlite.path);
  const id = crypto.randomUUID();
  const deviceId = getDeviceId(config);
  const userToken = getUserToken(config);
  const storageType = storageTypeOverride || config.storage.type;

  db.prepare(
    `INSERT INTO sync_log (
      id, started_at, status, files_uploaded, records_uploaded,
      device_id, user_token, storage_type, checkpoint
    )
     VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`
  ).run(id, nowIso(), "running", deviceId, userToken, storageType, checkpoint || null);
  db.close();
  return id;
}

async function updateSyncLog(config, id, update) {
  const db = await openDb(config.storage.sqlite.path);
  const fields = [];
  const values = [];
  Object.entries(update).forEach(([key, value]) => {
    fields.push(`${key} = ?`);
    values.push(value);
  });
  values.push(id);
  db.prepare(`UPDATE sync_log SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values
  );
  db.close();
}

async function finishSyncLog(config, id, status, errorMessage, filesUploaded, recordsUploaded) {
  await updateSyncLog(config, id, {
    completed_at: nowIso(),
    status,
    error_message: errorMessage || null,
    files_uploaded: filesUploaded || 0,
    records_uploaded: recordsUploaded || 0,
  });
}

async function getSyncState(config) {
  const db = await openDb(config.storage.sqlite.path);
  const deviceId = getDeviceId(config);
  const row = db
    .prepare("SELECT last_synced_at, last_synced_id FROM sync_state WHERE device_id = ?")
    .get(deviceId);
  db.close();
  if (!row) return { lastSyncedAt: null, lastSyncedId: null };
  return { lastSyncedAt: row.last_synced_at, lastSyncedId: row.last_synced_id };
}

async function updateSyncState(config, lastSyncedAt, lastSyncedId) {
  const db = await openDb(config.storage.sqlite.path);
  const deviceId = getDeviceId(config);
  const now = nowIso();
  db.prepare(
    `INSERT INTO sync_state (device_id, last_synced_at, last_synced_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       last_synced_id = excluded.last_synced_id,
       updated_at = excluded.updated_at`
  ).run(deviceId, lastSyncedAt, lastSyncedId || null, now);
  db.close();
}

async function getSyncStatus(config, limit = 5) {
  const db = await openDb(config.storage.sqlite.path);
  const deviceId = getDeviceId(config);
  const logs = db
    .prepare(
      `SELECT * FROM sync_log
       WHERE device_id = ?
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .all(deviceId, limit);
  db.close();

  const lastSuccess = logs.find((log) => log.status === "success") || null;
  const lastFailure = logs.find((log) => log.status === "failed") || null;
  const checkpoint = await getSyncState(config);

  return { checkpoint, lastSuccess, lastFailure, recent: logs };
}

module.exports = {
  createSyncLog,
  finishSyncLog,
  getSyncState,
  updateSyncState,
  getSyncStatus,
  getDeviceId,
  getUserToken,
};

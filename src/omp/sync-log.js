const crypto = require("crypto");
const os = require("os");
const { openDb, nowIso } = require("./db");
const { acquireIngestLock } = require("./ingest");
const { releaseSyncLock } = require("./sync-lock");

async function withDatabaseOperation(config, callback) {
  const operationLock = await acquireIngestLock();
  if (!operationLock.ok) {
    const error = new Error("Local database is busy; sync will retry later");
    error.code = "OMP_DB_BUSY";
    throw error;
  }

  let db;
  try {
    db = await openDb(config.storage.sqlite.path);
    return await callback(db);
  } finally {
    try {
      if (db) db.close();
    } finally {
      releaseSyncLock(operationLock.lockPath);
    }
  }
}

function getDeviceId(config) {
  return config.server?.deviceId || config.sync?.deviceId || os.hostname();
}

async function createSyncLog(config, checkpoint, storageTypeOverride) {
  return withDatabaseOperation(config, (db) => {
    const id = crypto.randomUUID();
    const deviceId = getDeviceId(config);
    const storageType = storageTypeOverride || config.storage.type;
    db.prepare(
      `INSERT INTO sync_log (
        id, started_at, status, files_uploaded, records_uploaded,
        device_id, storage_type, checkpoint
      )
       VALUES (?, ?, ?, 0, 0, ?, ?, ?)`
    ).run(id, nowIso(), "running", deviceId, storageType, checkpoint || null);
    return id;
  });
}

async function updateSyncLog(config, id, update) {
  return withDatabaseOperation(config, (db) => {
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
  });
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
  return withDatabaseOperation(config, (db) => {
    const deviceId = getDeviceId(config);
    const row = db
      .prepare("SELECT last_synced_at, last_synced_id FROM sync_state WHERE device_id = ?")
      .get(deviceId);
    if (!row) return { lastSyncedAt: null, lastSyncedId: null };
    return { lastSyncedAt: row.last_synced_at, lastSyncedId: row.last_synced_id };
  });
}

async function updateSyncState(config, lastSyncedAt, lastSyncedId) {
  return withDatabaseOperation(config, (db) => {
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
  });
}

async function getSyncStatus(config, limit = 5) {
  return withDatabaseOperation(config, (db) => {
    const deviceId = getDeviceId(config);
    const logs = db
      .prepare(
        `SELECT id, started_at, completed_at, status, files_uploaded,
                records_uploaded, error_message, device_id, storage_type, checkpoint
         FROM sync_log
         WHERE device_id = ?
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(deviceId, limit);
    const state = db
      .prepare("SELECT last_synced_at, last_synced_id FROM sync_state WHERE device_id = ?")
      .get(deviceId);
    const checkpoint = state
      ? { lastSyncedAt: state.last_synced_at, lastSyncedId: state.last_synced_id }
      : { lastSyncedAt: null, lastSyncedId: null };
    return {
      checkpoint,
      lastSuccess: logs.find((log) => log.status === "success") || null,
      lastFailure: logs.find((log) => log.status === "failed") || null,
      recent: logs,
    };
  });
}

module.exports = {
  createSyncLog,
  finishSyncLog,
  getSyncState,
  updateSyncState,
  getSyncStatus,
  getDeviceId,
  withDatabaseOperation,
};

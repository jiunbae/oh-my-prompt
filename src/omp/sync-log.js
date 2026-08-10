const crypto = require("crypto");
const os = require("os");
const { openDb, nowIso } = require("./db");
const {
  acquireIngestLock,
  reportLockWait,
  LONG_LOCK_WAIT_MS,
} = require("./ingest");
const { releaseSyncLock } = require("./sync-lock");

async function withDatabaseOperation(config, callback) {
  const operationLock = await acquireIngestLock({
    waitMs: LONG_LOCK_WAIT_MS,
    onWait: reportLockWait("sync"),
  });
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
      releaseSyncLock(operationLock.lockPath, { owner: operationLock.lockInfo });
    }
  }
}

function getDeviceId(config) {
  return config.server?.deviceId || config.sync?.deviceId || os.hostname();
}

function createSyncRun(config, checkpoint, storageTypeOverride) {
  return {
    id: crypto.randomUUID(),
    startedAt: nowIso(),
    deviceId: getDeviceId(config),
    storageType: storageTypeOverride || config.storage?.type || "sqlite",
    checkpoint: checkpoint || null,
  };
}

function writeSyncState(db, deviceId, lastSyncedAt, lastSyncedId) {
  db.prepare(
    `INSERT INTO sync_state (device_id, last_synced_at, last_synced_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       last_synced_id = excluded.last_synced_id,
       updated_at = excluded.updated_at`
  ).run(deviceId, lastSyncedAt, lastSyncedId || null, nowIso());
}

/**
 * Persist a sync checkpoint and its log entry in one database transaction.
 * sql.js serialises the entire DB after a transaction, so combining these
 * logically related writes avoids one full-file rewrite per sync boundary.
 */
async function persistSyncRun(config, run, progress) {
  return withDatabaseOperation(config, (db) => {
    const persist = db.transaction(() => {
      if (progress.persistCheckpoint) {
        writeSyncState(
          db,
          run.deviceId,
          progress.lastSyncedAt,
          progress.lastSyncedId
        );
      }

      const status = progress.status || "running";
      const completedAt = status === "running" ? null : nowIso();
      db.prepare(
        `INSERT INTO sync_log (
          id, started_at, completed_at, status, files_uploaded,
          records_uploaded, error_message, device_id, storage_type, checkpoint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          completed_at = excluded.completed_at,
          status = excluded.status,
          files_uploaded = excluded.files_uploaded,
          records_uploaded = excluded.records_uploaded,
          error_message = excluded.error_message`
      ).run(
        run.id,
        run.startedAt,
        completedAt,
        status,
        progress.filesUploaded ?? 0,
        progress.recordsUploaded ?? 0,
        progress.errorMessage || null,
        run.deviceId,
        run.storageType,
        run.checkpoint
      );
    });
    persist();
  });
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
    writeSyncState(db, getDeviceId(config), lastSyncedAt, lastSyncedId);
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
  createSyncRun,
  persistSyncRun,
  createSyncLog,
  finishSyncLog,
  getSyncState,
  updateSyncState,
  getSyncStatus,
  getDeviceId,
  withDatabaseOperation,
};

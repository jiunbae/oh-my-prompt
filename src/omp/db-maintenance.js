const {
  hasFtsTable,
  deleteFtsRow,
  clearFtsIndex,
  repairFtsIndex,
} = require("./fts");

function deletePromptById(db, promptId) {
  return db.transaction(() => {
    const row = db.prepare("SELECT rowid FROM prompts WHERE id = ?").get(promptId);
    if (!row) return { deleted: 0 };
    deleteFtsRow(db, row.rowid);
    const result = db.prepare("DELETE FROM prompts WHERE id = ?").run(promptId);
    return { deleted: result.changes };
  })();
}

function deleteSession(db, sessionId) {
  return db.transaction(() => {
    let ftsDeleted = 0;
    if (hasFtsTable(db)) {
      ftsDeleted = db
        .prepare(
          `DELETE FROM prompts_fts
           WHERE rowid IN (SELECT rowid FROM prompts WHERE session_id = ?)`
        )
        .run(sessionId).changes;
    }
    const result = db.prepare("DELETE FROM prompts WHERE session_id = ?").run(sessionId);
    return { deleted: result.changes, ftsDeleted };
  })();
}

function flushLocalDatabase(db) {
  return db.transaction(() => {
    const ftsDeleted = clearFtsIndex(db);
    const promptsDeleted = db.prepare("DELETE FROM prompts").run().changes;
    db.prepare("DELETE FROM sync_log").run();
    db.prepare("DELETE FROM sync_state").run();
    return { promptsDeleted, ftsDeleted };
  })();
}

module.exports = {
  deletePromptById,
  deleteSession,
  flushLocalDatabase,
  repairFtsIndex,
};

function hasFtsTable(db) {
  return Boolean(
    db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
      .get()
  );
}

function isMissingFtsTableError(error) {
  return /no such table:\s*(?:main\.)?prompts_fts/i.test(error?.message || "");
}

function insertFtsRow(db, rowid, promptText, responseText) {
  try {
    db.prepare(
      "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (?, ?, ?)"
    ).run(rowid, promptText || "", responseText || "");
    return true;
  } catch (error) {
    if (isMissingFtsTableError(error)) return false;
    throw error;
  }
}

function updateFtsResponse(db, rowid, promptText, responseText) {
  let updated;
  try {
    updated = db
      .prepare("UPDATE prompts_fts SET prompt_text = ?, response_text = ? WHERE rowid = ?")
      .run(promptText || "", responseText || "", rowid);
  } catch (error) {
    if (isMissingFtsTableError(error)) return false;
    throw error;
  }
  if (updated.changes === 0) {
    insertFtsRow(db, rowid, promptText, responseText);
  }
  return true;
}

function deleteFtsRow(db, rowid) {
  if (rowid === undefined || rowid === null) return 0;
  try {
    return db.prepare("DELETE FROM prompts_fts WHERE rowid = ?").run(rowid).changes;
  } catch (error) {
    if (isMissingFtsTableError(error)) return 0;
    throw error;
  }
}

function clearFtsIndex(db) {
  try {
    return db.prepare("DELETE FROM prompts_fts").run().changes;
  } catch (error) {
    if (isMissingFtsTableError(error)) return 0;
    throw error;
  }
}

function getFtsHealth(db) {
  const totalPrompts = db.prepare("SELECT COUNT(*) AS count FROM prompts").get().count;
  if (!hasFtsTable(db)) {
    return {
      available: false,
      totalPrompts,
      totalIndexed: 0,
      missing: totalPrompts,
      orphaned: 0,
      stale: 0,
      inSync: false,
    };
  }

  const totalIndexed = db.prepare("SELECT COUNT(*) AS count FROM prompts_fts").get().count;
  const missing = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM prompts p
       LEFT JOIN prompts_fts f ON f.rowid = p.rowid
       WHERE f.rowid IS NULL`
    )
    .get().count;
  const orphaned = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM prompts_fts f
       LEFT JOIN prompts p ON p.rowid = f.rowid
       WHERE p.rowid IS NULL`
    )
    .get().count;
  const stale = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM prompts p
       JOIN prompts_fts f ON f.rowid = p.rowid
       WHERE f.prompt_text IS NOT p.prompt_text
          OR f.response_text IS NOT COALESCE(p.response_text, '')`
    )
    .get().count;

  return {
    available: true,
    totalPrompts,
    totalIndexed,
    missing,
    orphaned,
    stale,
    inSync: missing === 0 && orphaned === 0 && stale === 0,
  };
}

function repairFtsIndex(db, options = {}) {
  const before = getFtsHealth(db);
  if (!before.available) {
    return {
      ...before,
      repaired: false,
      inserted: 0,
      deleted: 0,
      updated: 0,
      before,
    };
  }

  const repair = () => {
    const deleted = db
      .prepare(
        `DELETE FROM prompts_fts
         WHERE rowid IN (
           SELECT f.rowid
           FROM prompts_fts f
           LEFT JOIN prompts p ON p.rowid = f.rowid
           WHERE p.rowid IS NULL
         )`
      )
      .run().changes;
    const inserted = db
      .prepare(
        `INSERT INTO prompts_fts (rowid, prompt_text, response_text)
         SELECT p.rowid, p.prompt_text, COALESCE(p.response_text, '')
         FROM prompts p
         LEFT JOIN prompts_fts f ON f.rowid = p.rowid
         WHERE f.rowid IS NULL`
      )
      .run().changes;
    const staleRows = db
      .prepare(
        `SELECT p.rowid, p.prompt_text, p.response_text
         FROM prompts p
         JOIN prompts_fts f ON f.rowid = p.rowid
         WHERE f.prompt_text IS NOT p.prompt_text
            OR f.response_text IS NOT COALESCE(p.response_text, '')`
      )
      .all();
    const update = db.prepare(
      "UPDATE prompts_fts SET prompt_text = ?, response_text = ? WHERE rowid = ?"
    );
    let updated = 0;
    for (const row of staleRows) {
      updated += update.run(row.prompt_text || "", row.response_text || "", row.rowid)
        .changes;
    }
    return { inserted, deleted, updated };
  };

  const changes = options.transaction === false ? repair() : db.transaction(repair)();
  const after = getFtsHealth(db);
  return {
    ...after,
    repaired: changes.inserted > 0 || changes.deleted > 0 || changes.updated > 0,
    ...changes,
    before,
  };
}

module.exports = {
  hasFtsTable,
  insertFtsRow,
  updateFtsResponse,
  deleteFtsRow,
  clearFtsIndex,
  getFtsHealth,
  repairFtsIndex,
};

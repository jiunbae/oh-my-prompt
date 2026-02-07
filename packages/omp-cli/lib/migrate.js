const { openDb } = require("./db");

function getSchemaVersion(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  if (!row) return 0;
  const versionRow = db
    .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
    .get();
  return versionRow ? versionRow.version : 0;
}

function migrateDatabase(config) {
  const db = openDb(config.storage.sqlite.path);
  const version = getSchemaVersion(db);
  db.close();
  return { version };
}

module.exports = {
  migrateDatabase,
};

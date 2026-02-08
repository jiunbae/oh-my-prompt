const { openDb, getCurrentVersion: getSchemaVersion } = require("./db");

function migrateDatabase(config) {
  const db = openDb(config.storage.sqlite.path);
  const version = getSchemaVersion(db);
  db.close();
  return { version };
}

module.exports = {
  migrateDatabase,
};

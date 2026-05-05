const { openDb, getCurrentVersion: getSchemaVersion } = require("./db");

async function migrateDatabase(config) {
  const db = await openDb(config.storage.sqlite.path);
  const version = getSchemaVersion(db);
  db.close();
  return { version };
}

module.exports = {
  migrateDatabase,
};

const { DatabaseSync } = require("node:sqlite");

// Some Node 22 builds expose SQLite but omit FTS4, which existing portable
// databases require. Reject those builds before auto-selection or file access.
const probe = new DatabaseSync(":memory:");
try {
  if (typeof probe.prepare("SELECT 1").setAllowUnknownNamedParameters !== "function") {
    throw new Error("Built-in SQLite requires the named-parameter binding API");
  }
  probe.exec("CREATE VIRTUAL TABLE temp.omp_fts_probe USING fts4(text)");
} finally {
  probe.close();
}

// Adapt Node's file-backed SQLite to the small better-sqlite3 interface used
// by NativeDatabaseWrapper. Both drivers share WAL, transition backups and
// batch/savepoint handling rather than duplicating persistence logic.
class NodeSqliteDatabase {
  constructor(filePath, options = {}) {
    this._db = new DatabaseSync(filePath, {
      readOnly: !!options.readonly,
      // Existing sql.js databases may contain legacy SQL using double quotes.
      enableDoubleQuotedStringLiterals: true,
    });
    this._db.exec(`PRAGMA busy_timeout = ${Number(options.timeout) || 15000}`);
    this._savepointId = 0;
  }

  prepare(sql) {
    const statement = this._db.prepare(sql);
    statement.setAllowBareNamedParameters(true);
    statement.setAllowUnknownNamedParameters(true);
    return statement;
  }

  exec(sql) {
    this._db.exec(sql);
  }

  pragma(sql, options = {}) {
    const rows = this._db.prepare(`PRAGMA ${sql}`).all();
    return options.simple ? (rows[0] && Object.values(rows[0])[0]) : rows;
  }

  transaction(fn) {
    const db = this._db;
    const name = `omp_node_${++this._savepointId}`;
    return function (...args) {
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn.apply(this, args);
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        try {
          db.exec(`ROLLBACK TO ${name}`);
          db.exec(`RELEASE ${name}`);
        } catch {}
        throw error;
      }
    };
  }

  close() {
    this._db.close();
  }
}

module.exports = { NodeSqliteDatabase };

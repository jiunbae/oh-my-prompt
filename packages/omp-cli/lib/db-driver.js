const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

let SQL = null;

async function initDriver() {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

/**
 * Convert better-sqlite3 style params to sql.js binding format.
 *
 * better-sqlite3 patterns:
 *   stmt.run(val1, val2)           -> positional
 *   stmt.run({ id: 1, name: 'x' }) -> named (SQL uses @id, @name)
 *
 * sql.js expects:
 *   stmt.bind([val1, val2])        -> positional
 *   stmt.bind({ '@id': 1, '@name': 'x' }) -> named
 */
function convertParams(args) {
  if (args.length === 0) return undefined;

  // Single object argument -> named parameters
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Buffer) &&
    !(args[0] instanceof Uint8Array)
  ) {
    const obj = args[0];
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      // better-sqlite3 SQL uses @param; sql.js accepts @, :, or $
      // Prefix with @ if not already prefixed
      const prefixed =
        key.startsWith("@") || key.startsWith(":") || key.startsWith("$")
          ? key
          : `@${key}`;
      converted[prefixed] = value === undefined ? null : value;
    }
    return converted;
  }

  // Multiple positional args -> array
  return args.map((v) => (v === undefined ? null : v));
}

class StatementWrapper {
  constructor(wrapper, sql) {
    this._wrapper = wrapper; // DatabaseWrapper instance
    this._db = wrapper._db; // raw sql.js Database
    this._sql = sql;
  }

  run(...args) {
    const params = convertParams(args);
    if (params !== undefined) {
      this._db.run(this._sql, params);
    } else {
      this._db.run(this._sql);
    }
    const changes = this._db.getRowsModified();
    // Auto-save after writes (outside transactions, not in batch mode)
    if (!this._wrapper._inTransaction) {
      if (this._wrapper._batchMode) {
        this._wrapper._batchDirty = true;
      } else {
        this._wrapper._save();
      }
    }
    return { changes };
  }

  get(...args) {
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      const params = convertParams(args);
      if (params !== undefined) stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      if (stmt) stmt.free();
    }
  }

  all(...args) {
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      const params = convertParams(args);
      if (params !== undefined) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      if (stmt) stmt.free();
    }
  }
}

// PRAGMAs that are no-ops for sql.js (WAL / sync are meaningless in-memory)
const SKIPPED_PRAGMAS = /^(journal_mode\s*=\s*WAL|synchronous\s*=)/i;

class DatabaseWrapper {
  constructor(sqlJsDb, filePath, options = {}) {
    this._db = sqlJsDb;
    this._filePath = filePath;
    this._readonly = !!options.readonly;
    this._inTransaction = false;
    this._batchMode = false;
    this._batchDirty = false;
  }

  /** Enable batch mode: suppress auto-save after each write. Call flush() to persist. */
  setBatchMode(enabled) {
    this._batchMode = enabled;
    if (!enabled && this._batchDirty) {
      this._save();
      this._batchDirty = false;
    }
  }

  /** Persist to disk now (useful in batch mode). */
  flush() {
    if (this._batchDirty) {
      this._save();
      this._batchDirty = false;
    }
  }

  prepare(sql) {
    return new StatementWrapper(this, sql);
  }

  exec(sql) {
    this._db.exec(sql);
    if (!this._inTransaction) {
      if (this._batchMode) {
        this._batchDirty = true;
      } else {
        this._save();
      }
    }
  }

  pragma(pragmaStr) {
    if (SKIPPED_PRAGMAS.test(pragmaStr.trim())) {
      return undefined;
    }

    const sql = `PRAGMA ${pragmaStr}`;
    let stmt;
    try {
      stmt = this._db.prepare(sql);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      // PRAGMA setters (e.g. foreign_keys = ON) return no rows -> return undefined
      // PRAGMA getters (e.g. table_info(...)) return rows -> return the array
      return rows.length > 0 ? rows : undefined;
    } finally {
      if (stmt) stmt.free();
    }
  }

  transaction(fn) {
    const self = this;
    const wrapper = function (...args) {
      self._db.run("BEGIN");
      self._inTransaction = true;
      try {
        const result = fn.apply(this, args);
        self._db.run("COMMIT");
        self._inTransaction = false;
        self._save();
        return result;
      } catch (err) {
        self._db.run("ROLLBACK");
        self._inTransaction = false;
        throw err;
      }
    };
    return wrapper;
  }

  close() {
    this._save();
    this._db.close();
  }

  /** Persist the in-memory database to disk (no-op for readonly) */
  _save() {
    if (this._readonly || !this._filePath) return;
    try {
      const data = this._db.export();
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._filePath, Buffer.from(data));
    } catch {
      // Silently ignore save errors (e.g. in-memory only usage)
    }
  }
}

async function openDatabase(filePath, options = {}) {
  const drv = await initDriver();

  let db;
  if (filePath && fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    db = new drv.Database(fileBuffer);
  } else {
    db = new drv.Database();
  }

  return new DatabaseWrapper(db, filePath, options);
}

module.exports = { openDatabase, initDriver };

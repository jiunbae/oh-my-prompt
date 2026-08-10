const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const WRITE_LOCK_TIMEOUT_MS = 2_000;
const WRITE_LOCK_STALE_MS = 30_000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function fileVersion(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
}

function waitForWriteLock(lockPath) {
  const deadline = Date.now() + WRITE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > WRITE_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
        continue;
      }
      if (Date.now() >= deadline) {
        const timeoutError = new Error("Timed out waiting for the local database write lock");
        timeoutError.code = "OMP_DB_WRITE_LOCK_TIMEOUT";
        throw timeoutError;
      }
      Atomics.wait(SLEEP_BUFFER, 0, 0, 25);
    }
  }
}

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
    // Auto-save after writes (outside transactions, not in batch mode). A
    // transaction tracks whether anything actually changed so a read-only
    // transaction or INSERT ... DO NOTHING does not rewrite the whole file.
    if (this._wrapper._inTransaction) {
      if (changes > 0) this._wrapper._transactionDirty = true;
    } else {
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
    this._diskVersion = options.diskVersion ?? null;
    this._inTransaction = false;
    this._transactionDirty = false;
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
    if (this._inTransaction) {
      this._transactionDirty = true;
    } else {
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
      self._transactionDirty = false;
      let result;
      try {
        result = fn.apply(this, args);
        self._db.run("COMMIT");
      } catch (err) {
        try {
          self._db.run("ROLLBACK");
        } catch {}
        self._inTransaction = false;
        self._transactionDirty = false;
        throw err;
      }
      self._inTransaction = false;
      const dirty = self._transactionDirty;
      self._transactionDirty = false;
      // Persist after leaving the SQL transaction. A disk-version conflict is
      // not a SQL rollback condition and must propagate with its original code.
      // Batch mode still wins: a caller that opted into deferring writes (e.g.
      // backfill) must not get a full-file rewrite per transaction.
      if (!dirty) {
        return result;
      }
      if (self._batchMode) {
        self._batchDirty = true;
      } else {
        self._save();
      }
      return result;
    };
    return wrapper;
  }

  close() {
    // Normal writes are persisted eagerly. Only a pending batch needs a final
    // flush here; re-saving an unchanged snapshot on every read-only command
    // can otherwise overwrite data written by another process.
    this.flush();
    this._db.close();
  }

  /** Persist the in-memory database to disk (no-op for readonly) */
  _save() {
    if (this._readonly || !this._filePath) return;
    // Atomic write: a torn fs.writeFileSync of the whole DB (process killed
    // mid-write, or a concurrent omp process) leaves a corrupt "database
    // disk image is malformed" file. Write to a temp file, fsync, then
    // rename — rename is atomic on the same filesystem, so the DB is always
    // either fully old or fully new, never half-written.
    const tmp = `${this._filePath}.tmp-${process.pid}`;
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lockPath = `${this._filePath}.write.lock`;
    waitForWriteLock(lockPath);
    try {
      const currentVersion = fileVersion(this._filePath);
      if (currentVersion !== this._diskVersion) {
        const conflict = new Error(
          "Local database changed in another process; refusing to overwrite newer data",
        );
        conflict.code = "OMP_DB_CONCURRENT_MODIFICATION";
        throw conflict;
      }

      const data = this._db.export();
      const fd = fs.openSync(tmp, "w", 0o600);
      try {
        fs.writeSync(fd, Buffer.from(data));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this._filePath);
      fs.chmodSync(this._filePath, 0o600);
      this._diskVersion = fileVersion(this._filePath);
    } catch (error) {
      // Never report a successful capture when the durable write failed.
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {}
      throw error;
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

// A writer killed mid-save (SIGKILL, OOM, a dead terminal) never reaches the
// cleanup in _save's catch, leaving a full-size `omp.db.tmp-<pid>` behind. They
// are never reclaimed otherwise and each one is as large as the database, so a
// few dozen quietly cost gigabytes. Sweep them when opening for writing.
//
// Age, not liveness, decides: PIDs get recycled, so a live /proc/<pid> says
// nothing about whether *this* process wrote the file. No legitimate save takes
// an hour, so anything older than that is abandoned.
const TEMP_ORPHAN_AGE_MS = 60 * 60 * 1000;

function sweepOrphanTemps(filePath) {
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.tmp-`;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - TEMP_ORPHAN_AGE_MS;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !/^\d+$/.test(entry.slice(prefix.length))) {
      continue;
    }
    const candidate = path.join(dir, entry);
    try {
      if (fs.statSync(candidate).mtimeMs < cutoff) fs.unlinkSync(candidate);
    } catch {
      // Racing another sweep, or not ours to remove — leave it.
    }
  }
}

async function openDatabase(filePath, options = {}) {
  const drv = await initDriver();
  if (filePath && !options.readonly) sweepOrphanTemps(filePath);

  let db;
  let diskVersion = null;
  if (filePath && fs.existsSync(filePath)) {
    if (!options.readonly) fs.chmodSync(filePath, 0o600);
    let fileBuffer;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = fileVersion(filePath);
      fileBuffer = fs.readFileSync(filePath);
      const after = fileVersion(filePath);
      if (before === after) {
        diskVersion = after;
        break;
      }
    }
    if (!fileBuffer || diskVersion === null) {
      throw new Error("Local database changed repeatedly while it was being opened");
    }
    db = new drv.Database(fileBuffer);
  } else {
    db = new drv.Database();
  }

  return new DatabaseWrapper(db, filePath, { ...options, diskVersion });
}

module.exports = { openDatabase, initDriver };

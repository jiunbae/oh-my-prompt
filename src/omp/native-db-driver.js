const fs = require("fs");
const path = require("path");

const TRANSITION_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

function sweepTransitionTemps(backupPath) {
  const dir = path.dirname(backupPath);
  const prefix = `${path.basename(backupPath)}.tmp-`;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - TRANSITION_TEMP_MAX_AGE_MS;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !/^\d+$/.test(entry.slice(prefix.length))) {
      continue;
    }
    const candidate = path.join(dir, entry);
    try {
      if (fs.statSync(candidate).mtimeMs < cutoff) fs.unlinkSync(candidate);
    } catch {}
  }
}

function createTransitionBackup(filePath, backupPath) {
  if (fs.existsSync(backupPath)) return;

  const temporaryPath = `${backupPath}.tmp-${process.pid}`;
  try {
    // Build and fsync a private complete copy first. Hard-linking it into the
    // final name is atomic and refuses to overwrite a backup won by a racing
    // process. COPYFILE_FICLONE transparently falls back to a normal copy.
    fs.copyFileSync(filePath, temporaryPath, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(temporaryPath, 0o600);
    const fd = fs.openSync(temporaryPath, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(temporaryPath, backupPath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch {}
  }
}

function writeTransitionMarker(markerPath) {
  const temporaryPath = `${markerPath}.tmp-${process.pid}`;
  try {
    const payload = JSON.stringify({
      driver: "better-sqlite3",
      transitionedAt: new Date().toISOString(),
    });
    const fd = fs.openSync(temporaryPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporaryPath, markerPath);
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch {}
  }
}

function normalizeArgs(args) {
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Buffer) &&
    !(args[0] instanceof Uint8Array)
  ) {
    return [Object.fromEntries(
      Object.entries(args[0]).map(([key, value]) => [key, value ?? null])
    )];
  }
  return args.map((value) => value ?? null);
}

class NativeStatementWrapper {
  constructor(statement) {
    this._statement = statement;
  }

  run(...args) {
    const result = this._statement.run(...normalizeArgs(args));
    return { changes: Number(result.changes) };
  }

  get(...args) {
    return this._statement.get(...normalizeArgs(args));
  }

  all(...args) {
    return this._statement.all(...normalizeArgs(args));
  }
}

class NativeDatabaseWrapper {
  constructor(db, filePath, options = {}) {
    this._db = db;
    this._filePath = filePath;
    this._readonly = !!options.readonly;
    this._batchMode = false;
    this._savepointId = 0;
    this.driver = "better-sqlite3";
  }

  setBatchMode(enabled) {
    const next = Boolean(enabled);
    if (next === this._batchMode) return;
    if (next) {
      this._db.exec("BEGIN");
      this._batchMode = true;
    } else {
      this._db.exec("COMMIT");
      this._batchMode = false;
    }
  }

  flush() {
    if (!this._batchMode) return;
    this._db.exec("COMMIT");
    this._db.exec("BEGIN");
  }

  prepare(sql) {
    return new NativeStatementWrapper(this._db.prepare(sql));
  }

  exec(sql) {
    this._db.exec(sql);
  }

  pragma(pragmaStr) {
    const rows = this._db.pragma(pragmaStr);
    return rows.length > 0 ? rows : undefined;
  }

  transaction(fn) {
    if (!this._batchMode) return this._db.transaction(fn);
    const self = this;
    return function (...args) {
      const savepoint = `omp_batch_${++self._savepointId}`;
      self._db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = fn.apply(this, args);
        self._db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        try {
          self._db.exec(`ROLLBACK TO ${savepoint}`);
          self._db.exec(`RELEASE ${savepoint}`);
        } catch {}
        throw error;
      }
    };
  }

  close() {
    if (this._batchMode) {
      this._db.exec("COMMIT");
      this._batchMode = false;
    }
    this._db.close();
  }
}

function openNativeDatabase(NativeDatabase, filePath, options = {}) {
  const existingFile = Boolean(filePath && fs.existsSync(filePath));
  const markerPath = filePath ? `${filePath}.native-driver` : null;
  const needsTransition = existingFile && !options.readonly && !fs.existsSync(markerPath);
  if (filePath && !options.readonly) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    sweepTransitionTemps(`${filePath}.pre-native.bak`);
    sweepTransitionTemps(markerPath);
    if (needsTransition) {
      const backupPath = `${filePath}.pre-native.bak`;
      createTransitionBackup(filePath, backupPath);
    }
  }
  const target = filePath || ":memory:";
  const db = new NativeDatabase(target, {
    readonly: !!options.readonly,
    fileMustExist: Boolean(filePath && options.readonly),
    timeout: 15000,
  });
  if (filePath && !options.readonly) {
    fs.chmodSync(filePath, 0o600);
    if (needsTransition) {
      const integrity = db.pragma("quick_check", { simple: true });
      if (integrity !== "ok") {
        db.close();
        throw new Error(
          `Native SQLite transition aborted: quick_check returned ${String(integrity)}`
        );
      }
      writeTransitionMarker(markerPath);
    }
  }
  return new NativeDatabaseWrapper(db, filePath, options);
}

module.exports = { NativeDatabaseWrapper, openNativeDatabase };

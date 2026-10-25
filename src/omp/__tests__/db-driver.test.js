const fs = require("fs");
const os = require("os");
const path = require("path");
const { openDatabase, getDriverInfo } = require("../db-driver");

it("retains the portable driver when built-in SQLite lacks FTS4", () => {
  const { execFileSync } = require("child_process");
  const result = execFileSync(process.execPath, ["-e", `
    const Module = require('module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'better-sqlite3') throw new Error('addon unavailable');
      if (name === 'node:sqlite') return { DatabaseSync: class {
        prepare() { return { setAllowUnknownNamedParameters() {} }; }
        exec() { throw new Error('no such module: fts4'); }
        close() {}
      }};
      return load.call(this, name, ...args);
    };
    console.log(JSON.stringify(require(${JSON.stringify(require.resolve("../db-driver"))}).getDriverInfo('auto')));
  `], { encoding: "utf8" });
  expect(JSON.parse(result)).toEqual({ name: "sql.js", native: false, fallback: true });
});

describe("sql.js database durability", () => {
  let previousDriver;

  beforeAll(() => {
    previousDriver = process.env.OMP_SQLITE_DRIVER;
    process.env.OMP_SQLITE_DRIVER = "sql.js";
  });

  afterAll(() => {
    if (previousDriver === undefined) delete process.env.OMP_SQLITE_DRIVER;
    else process.env.OMP_SQLITE_DRIVER = previousDriver;
  });

  it("refuses a stale writer instead of overwriting newer process data", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-db-driver-"));
    const dbPath = path.join(root, "omp.db");

    const bootstrap = await openDatabase(dbPath);
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();

    const first = await openDatabase(dbPath);
    const stale = await openDatabase(dbPath);

    first.prepare("INSERT INTO records (id) VALUES (?)").run("first");
    expect(() =>
      stale.prepare("INSERT INTO records (id) VALUES (?)").run("stale"),
    ).toThrow(/changed in another process/);

    first.close();
    stale.close();

    const verify = await openDatabase(dbPath, { readonly: true });
    expect(verify.prepare("SELECT id FROM records ORDER BY id").all()).toEqual([
      { id: "first" },
    ]);
    verify.close();
  });

  it("preserves the concurrent-modification error after an in-memory transaction commits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-db-transaction-"));
    const dbPath = path.join(root, "omp.db");
    const bootstrap = await openDatabase(dbPath);
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();

    const first = await openDatabase(dbPath);
    const stale = await openDatabase(dbPath);
    first.transaction(() => {
      first.prepare("INSERT INTO records (id) VALUES (?)").run("first");
    })();

    expect(() =>
      stale.transaction(() => {
        stale.prepare("INSERT INTO records (id) VALUES (?)").run("stale");
      })(),
    ).toThrow(/changed in another process/);

    first.close();
    stale.close();
  });

  it("sweeps abandoned temp files but keeps a save that is still in flight", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-db-sweep-"));
    const dbPath = path.join(root, "omp.db");
    const bootstrap = await openDatabase(dbPath);
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();

    const stale = `${dbPath}.tmp-999999`;
    const fresh = `${dbPath}.tmp-999998`;
    const staleReusedPid = `${dbPath}.tmp-${process.pid}`;
    const unrelated = `${dbPath}.tmp-backup`;
    fs.writeFileSync(stale, "abandoned");
    fs.writeFileSync(fresh, "in flight");
    fs.writeFileSync(staleReusedPid, "abandoned after pid reuse");
    fs.writeFileSync(unrelated, "not a writer temp");
    const old = Date.now() - 2 * 60 * 60 * 1000;
    fs.utimesSync(stale, old / 1000, old / 1000);
    fs.utimesSync(staleReusedPid, old / 1000, old / 1000);
    fs.utimesSync(unrelated, old / 1000, old / 1000);

    const db = await openDatabase(dbPath);
    db.close();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(staleReusedPid)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it("defers the file rewrite while batch mode is on, including inside a transaction", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-db-batch-"));
    const dbPath = path.join(root, "omp.db");
    const bootstrap = await openDatabase(dbPath);
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();

    const db = await openDatabase(dbPath);
    db.setBatchMode(true);
    db.transaction(() => {
      db.prepare("INSERT INTO records (id) VALUES (?)").run("batched");
    })();

    // Batch mode means nothing has touched the file yet — a transaction must
    // not force the full-file rewrite the caller explicitly deferred.
    const beforeFlush = await openDatabase(dbPath, { readonly: true });
    expect(beforeFlush.prepare("SELECT id FROM records").all()).toEqual([]);
    beforeFlush.close();

    db.flush();

    const afterFlush = await openDatabase(dbPath, { readonly: true });
    expect(afterFlush.prepare("SELECT id FROM records").all()).toEqual([
      { id: "batched" },
    ]);
    afterFlush.close();
    db.close();
  });

  it("does not rewrite the database for a transaction that changed no rows", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-db-read-transaction-"));
    const dbPath = path.join(root, "omp.db");
    const bootstrap = await openDatabase(dbPath);
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();

    const db = await openDatabase(dbPath);
    const renameSpy = vi.spyOn(fs, "renameSync");
    db.transaction(() => {
      db.prepare("INSERT INTO records (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run("first");
    })();
    const afterInsert = renameSpy.mock.calls.length;

    db.transaction(() => {
      db.prepare("INSERT INTO records (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run("first");
      db.prepare("SELECT id FROM records").all();
    })();

    expect(afterInsert).toBe(1);
    expect(renameSpy.mock.calls).toHaveLength(afterInsert);
    renameSpy.mockRestore();
    db.close();
  });

  it("writes the exported bytes directly and handles partial writes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-db-short-write-"));
    const dbPath = path.join(root, "omp.db");
    const db = await openDatabase(dbPath);
    db.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    const write = fs.writeSync.bind(fs);
    const spy = vi.spyOn(fs, "writeSync").mockImplementation((fd, data, offset, length) => {
      expect(data).toBeInstanceOf(Uint8Array);
      expect(Buffer.isBuffer(data)).toBe(false);
      return write(fd, data, offset, Math.min(length, 1024));
    });
    try {
      db.prepare("INSERT INTO records VALUES (?)").run("complete");
      expect(spy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
      db.close();
    }
    const verify = await openDatabase(dbPath, { readonly: true });
    expect(verify.prepare("PRAGMA quick_check").get().quick_check).toBe("ok");
    expect(verify.prepare("SELECT id FROM records").get().id).toBe("complete");
    verify.close();
  });
});

let hasBuiltinSqlite = false;
try {
  require("../node-sqlite-driver");
  hasBuiltinSqlite = true;
} catch {}

describe.skipIf(!hasBuiltinSqlite)("built-in SQLite fallback", () => {
  it("keeps writes atomic, binds extra named fields, and preserves rollback", async () => {
    const db = await openDatabase(null, { driver: "node:sqlite" });
    expect(db.driver).toBe("node:sqlite");
    db.exec("CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT)");
    const insert = db.prepare("INSERT INTO records VALUES (@id, @value)");
    db.transaction(() => insert.run({ id: "first", value: undefined, unused: "ignored" }))();
    expect(() => db.transaction(() => {
      insert.run({ id: "rolled-back", value: "absent" });
      throw new Error("rollback");
    })()).toThrow("rollback");
    expect(db.prepare("SELECT * FROM records").all()).toEqual([{ id: "first", value: null }]);
    db.close();
  });

  it("shares WAL, backups, batch flush and readonly protection with the native driver", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-node-sqlite-"));
    const dbPath = path.join(root, "omp.db");
    const bootstrap = await openDatabase(dbPath, { driver: "sql.js" });
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();
    const db = await openDatabase(dbPath, { driver: "node:sqlite" });
    expect(fs.existsSync(`${dbPath}.pre-native.bak`)).toBe(true);
    expect(JSON.parse(fs.readFileSync(`${dbPath}.native-driver`, "utf8")).driver).toBe("node:sqlite");
    expect(db.pragma("journal_mode = WAL")[0].journal_mode).toBe("wal");
    db.setBatchMode(true);
    const insert = db.prepare("INSERT INTO records VALUES (?)");
    db.transaction(() => insert.run("first"))();
    const reader = await openDatabase(dbPath, { driver: "node:sqlite", readonly: true });
    expect(reader.prepare("SELECT * FROM records").all()).toEqual([]);
    db.flush();
    expect(reader.prepare("SELECT * FROM records").all()).toEqual([{ id: "first" }]);
    expect(() => db.transaction(() => {
      insert.run("failed");
      throw new Error("rollback");
    })()).toThrow("rollback");
    db.transaction(() => insert.run("second"))();
    db.close();
    expect(reader.prepare("SELECT id FROM records ORDER BY id").all()).toEqual([{ id: "first" }, { id: "second" }]);
    expect(() => reader.prepare("INSERT INTO records VALUES (?)").run("forbidden")).toThrow();
    expect(reader.pragma("quick_check")[0].quick_check).toBe("ok");
    reader.close();
  });

  it("automatically selects built-in SQLite when the optional addon is unavailable", () => {
    const { execFileSync } = require("child_process");
    const result = execFileSync(process.execPath, ["-e", `
      const Module = require('module');
      const load = Module._load;
      Module._load = function(name, ...args) {
        if (name === 'better-sqlite3' || name === 'sql.js') throw new Error('not installed');
        return load.call(this, name, ...args);
      };
      const driver = require(${JSON.stringify(require.resolve("../db-driver"))});
      console.log(JSON.stringify(driver.getDriverInfo('auto')));
    `], { encoding: "utf8" });
    expect(JSON.parse(result)).toEqual({ name: "node:sqlite", native: true, fallback: false });
  });
});

describe("native SQLite driver", () => {
  it("blocks portable reads and stale writes while native WAL contains committed rows", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-wal-safety-"));
    const dbPath = path.join(root, "omp.db");
    const native = await openDatabase(dbPath, { driver: "native" });
    native.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)");
    native.prepare("INSERT INTO records VALUES (?)").run(1);
    native.pragma("journal_mode = WAL");
    native.pragma("wal_autocheckpoint = 0");
    const portable = await openDatabase(dbPath, { driver: "sql.js" });
    try {
      native.prepare("INSERT INTO records VALUES (?)").run(2);
      expect(fs.statSync(`${dbPath}-wal`).size).toBeGreaterThan(0);
      for (const readonly of [false, true]) {
        await expect(openDatabase(dbPath, { driver: "sql.js", readonly })).rejects.toMatchObject({
          code: "OMP_SQLITE_WAL_PENDING",
        });
      }
      expect(() => portable.prepare("INSERT INTO records VALUES (?)").run(3)).toThrow(/nonempty SQLite WAL/);
      expect(native.prepare("SELECT id FROM records ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    } finally {
      portable.close();
      native.close();
    }
    // Closing the last native handle checkpoints the WAL. Portable access is
    // safe again, and the rejected stale writer must not have lost row 2.
    const verify = await openDatabase(dbPath, { driver: "sql.js", readonly: true });
    expect(verify.prepare("SELECT id FROM records ORDER BY id").all()).toEqual([{ id: 1 }, { id: 2 }]);
    verify.close();
  });

  it("uses WAL and persists page-level writes without replacing the DB file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-native-driver-"));
    const dbPath = path.join(root, "omp.db");
    const bootstrap = await openDatabase(dbPath, { driver: "sql.js" });
    bootstrap.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    bootstrap.close();

    const db = await openDatabase(dbPath, { driver: "native" });
    expect(db.driver).toBe("better-sqlite3");
    expect(fs.existsSync(`${dbPath}.pre-native.bak`)).toBe(true);
    expect(fs.existsSync(`${dbPath}.native-driver`)).toBe(true);
    expect(db.pragma("journal_mode = WAL")).toEqual([{ journal_mode: "wal" }]);

    const renameSpy = vi.spyOn(fs, "renameSync");
    db.prepare("INSERT INTO records (id) VALUES (?)").run("first");
    expect(renameSpy).not.toHaveBeenCalled();
    renameSpy.mockRestore();
    db.close();

    const verify = await openDatabase(dbPath, { driver: "native", readonly: true });
    expect(verify.prepare("SELECT id FROM records").all()).toEqual([{ id: "first" }]);
    verify.close();
  });

  it("allows concurrent handles without last-writer-wins data loss", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-native-concurrent-"));
    const dbPath = path.join(root, "omp.db");
    const first = await openDatabase(dbPath, { driver: "native" });
    first.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    first.pragma("journal_mode = WAL");
    const second = await openDatabase(dbPath, { driver: "native" });

    first.prepare("INSERT INTO records (id) VALUES (?)").run("first");
    second.prepare("INSERT INTO records (id) VALUES (?)").run("second");
    expect(first.prepare("SELECT id FROM records ORDER BY id").all()).toEqual([
      { id: "first" },
      { id: "second" },
    ]);
    second.close();
    first.close();
  });

  it("selects the available native driver in auto mode", () => {
    expect(getDriverInfo()).toEqual({
      name: "better-sqlite3",
      native: true,
      fallback: false,
    });
  });
});

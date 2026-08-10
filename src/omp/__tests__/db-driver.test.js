const fs = require("fs");
const os = require("os");
const path = require("path");
const { openDatabase } = require("../db-driver");

describe("sql.js database durability", () => {
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
});

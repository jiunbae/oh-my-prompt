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
});

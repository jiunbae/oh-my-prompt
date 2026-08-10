const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  summarizeDatabaseBackups,
  pruneDatabaseBackups,
} = require("../db-backups");

function writeOldFile(filePath, contents = "backup") {
  fs.writeFileSync(filePath, contents);
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  fs.utimesSync(filePath, old, old);
}

describe("database backup inventory", () => {
  it("lists only recognized database recovery artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-backups-"));
    const dbPath = path.join(root, "omp.db");
    fs.writeFileSync(dbPath, "active");
    fs.writeFileSync(`${dbPath}.pre-native.bak`, "native");
    fs.writeFileSync(`${dbPath}.stale-20260810`, "stale");
    fs.writeFileSync(path.join(root, "unrelated.txt"), "ignore");

    const summary = summarizeDatabaseBackups(dbPath);
    expect(summary).toMatchObject({ count: 2, protectedCount: 1 });
    expect(summary.files.map((file) => file.name)).not.toContain("unrelated.txt");
  });

  it("defaults to a dry run and protects the transition backup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-backup-prune-"));
    const dbPath = path.join(root, "omp.db");
    writeOldFile(`${dbPath}.pre-native.bak`);
    writeOldFile(`${dbPath}.pre-validation.bak`);

    const dryRun = pruneDatabaseBackups(dbPath, { olderThanDays: 30 });
    expect(dryRun.executed).toBe(false);
    expect(dryRun.candidates.map((file) => file.name)).toEqual([
      "omp.db.pre-validation.bak",
    ]);
    expect(fs.existsSync(`${dbPath}.pre-validation.bak`)).toBe(true);

    const executed = pruneDatabaseBackups(dbPath, { olderThanDays: 30, execute: true });
    expect(executed.deleted).toHaveLength(1);
    expect(fs.existsSync(`${dbPath}.pre-validation.bak`)).toBe(false);
    expect(fs.existsSync(`${dbPath}.pre-native.bak`)).toBe(true);
  });
});

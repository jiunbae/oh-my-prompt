const fs = require("fs");
const path = require("path");
const os = require("os");
const { acquireSyncLock, releaseSyncLock, refreshSyncLock } = require("../sync-lock");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

describe("sync-lock", () => {
  it("prevents concurrent acquisition", () => {
    makeTempRoot();
    const lock1 = acquireSyncLock({ ttlMs: 10000 });
    expect(lock1.ok).toBe(true);
    const lock2 = acquireSyncLock({ ttlMs: 10000 });
    expect(lock2.ok).toBe(false);
    releaseSyncLock(lock1.lockPath);
  });

  it("does not steal a stale lock from a live local process", () => {
    makeTempRoot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    try {
      const lock1 = acquireSyncLock({ ttlMs: 1000 });
      expect(lock1.ok).toBe(true);
      vi.advanceTimersByTime(2000);
      const lock2 = acquireSyncLock({ ttlMs: 1000 });
      expect(lock2.ok).toBe(false);
      releaseSyncLock(lock1.lockPath);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows stale lock recovery when the owner cannot be verified locally", () => {
    makeTempRoot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    try {
      const lock1 = acquireSyncLock({ ttlMs: 1000 });
      const payload = JSON.parse(fs.readFileSync(lock1.lockPath, "utf8"));
      fs.writeFileSync(lock1.lockPath, JSON.stringify({ ...payload, host: "remote-host" }));
      vi.advanceTimersByTime(2000);

      const lock2 = acquireSyncLock({ ttlMs: 1000 });
      expect(lock2.ok).toBe(true);
      releaseSyncLock(lock2.lockPath);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let an old owner remove a replacement lock", () => {
    makeTempRoot();
    const first = acquireSyncLock({ ttlMs: 10000 });
    const firstOwner = first.lockInfo;
    releaseSyncLock(first.lockPath);

    const replacement = acquireSyncLock({ ttlMs: 10000 });
    expect(refreshSyncLock(replacement.lockPath, firstOwner)).toBe(false);
    releaseSyncLock(replacement.lockPath, { owner: firstOwner });
    expect(fs.existsSync(replacement.lockPath)).toBe(true);
    releaseSyncLock(replacement.lockPath);
  });

  it("keeps a long-running lock fresh for a remote observer", () => {
    makeTempRoot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    try {
      const lock = acquireSyncLock({ ttlMs: 1000 });
      vi.advanceTimersByTime(750);
      expect(refreshSyncLock(lock.lockPath, lock.lockInfo)).toBe(true);
      const payload = JSON.parse(fs.readFileSync(lock.lockPath, "utf8"));
      fs.writeFileSync(lock.lockPath, JSON.stringify({ ...payload, host: "remote-host" }));
      const refreshed = new Date();
      fs.utimesSync(lock.lockPath, refreshed, refreshed);
      vi.advanceTimersByTime(750);

      expect(acquireSyncLock({ ttlMs: 1000 }).ok).toBe(false);
      fs.writeFileSync(lock.lockPath, JSON.stringify(payload));
      releaseSyncLock(lock.lockPath, { owner: lock.lockInfo });
    } finally {
      vi.useRealTimers();
    }
  });
});

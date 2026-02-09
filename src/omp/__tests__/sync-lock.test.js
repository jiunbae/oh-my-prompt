const fs = require("fs");
const path = require("path");
const os = require("os");
const { acquireSyncLock, releaseSyncLock } = require("../sync-lock");

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

  it("allows stale lock override", () => {
    makeTempRoot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    try {
      const lock1 = acquireSyncLock({ ttlMs: 1000 });
      expect(lock1.ok).toBe(true);
      vi.advanceTimersByTime(2000);
      const lock2 = acquireSyncLock({ ttlMs: 1000 });
      expect(lock2.ok).toBe(true);
      releaseSyncLock(lock2.lockPath);
    } finally {
      vi.useRealTimers();
    }
  });
});

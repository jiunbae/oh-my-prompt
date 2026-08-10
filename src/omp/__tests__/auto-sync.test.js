const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

describe("event-driven auto sync", () => {
  let previousConfigHome;

  beforeEach(() => {
    previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = fs.mkdtempSync(
      path.join(os.tmpdir(), "omp-auto-sync-test-")
    );
    vi.resetModules();
  });

  afterEach(() => {
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
  });

  it("uses OS file events for capture triggers", async () => {
    const { touchTrigger, watchTrigger } = require("../auto-sync");
    let watcher;
    let timeout;
    try {
      const triggered = new Promise((resolve, reject) => {
        watcher = watchTrigger(resolve, reject);
      });
      touchTrigger();
      await Promise.race([
        triggered,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("trigger event timed out")),
            2000
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (watcher) watcher.close();
    }
  });

  it("defaults the missed-event safety interval to one hour", () => {
    const { validateTimingConfig } = require("../auto-sync");
    expect(validateTimingConfig(undefined, undefined)).toEqual({
      debounce: 30,
      interval: 3600,
      errors: [],
    });
  });

  it("backs off all failure-triggered retries with an exponential cap", () => {
    const { computeFailureBackoffMs } = require("../auto-sync");
    expect(computeFailureBackoffMs(1, 30000, 3600000)).toBe(30000);
    expect(computeFailureBackoffMs(2, 30000, 3600000)).toBe(60000);
    expect(computeFailureBackoffMs(6, 30000, 3600000)).toBe(900000);
    expect(computeFailureBackoffMs(20, 30000, 3600000)).toBe(900000);
  });

  it("runs database-heavy sync work in a short-lived child process", async () => {
    const configPath = path.join(process.env.XDG_CONFIG_HOME, "config.json");
    const dbPath = path.join(process.env.XDG_CONFIG_HOME, "omp.db");
    fs.writeFileSync(configPath, JSON.stringify({
      server: { url: "http://127.0.0.1:9", token: "test-token" },
      storage: { type: "sqlite", sqlite: { path: dbPath } },
      capture: { response: true },
      sync: { enabled: true, deviceId: "worker-test" },
      queue: { maxBytes: 1024 * 1024 },
    }));

    const { launchSyncWorker } = require("../auto-sync");
    const worker = launchSyncWorker(configPath);
    const result = await worker.promise;

    expect(result).toMatchObject({ uploaded: 0, chunks: 0, duplicates: 0 });
    expect(worker.child.exitCode).toBe(0);
  });

  it("kills a worker that stops reporting liveness", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter();
      child.kill = vi.fn(() => child.emit("exit", null, "SIGKILL"));
      const { launchSyncWorker } = require("../auto-sync");
      const worker = launchSyncWorker(null, {
        fork: () => child,
        workerPath: "/unused-worker.js",
        stallTimeoutMs: 1000,
      });

      const rejected = expect(worker.promise).rejects.toMatchObject({
        code: "OMP_SYNC_WORKER_STALLED",
      });
      await vi.advanceTimersByTimeAsync(1001);
      await rejected;
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});

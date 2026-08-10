const fs = require("fs");
const os = require("os");
const path = require("path");

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
});

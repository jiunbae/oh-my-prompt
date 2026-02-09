const fs = require("fs");
const path = require("path");
const os = require("os");
const { enqueuePayload, getQueueStats } = require("../queue");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

describe("queue", () => {
  it("enforces queue size limit", () => {
    makeTempRoot();
    const maxBytes = 50;
    const payload = "x".repeat(40);

    enqueuePayload(payload, maxBytes);
    enqueuePayload(payload, maxBytes);

    const stats = getQueueStats();
    expect(stats.bytes).toBeLessThanOrEqual(maxBytes);
  });
});

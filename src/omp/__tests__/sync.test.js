const fs = require("fs");
const path = require("path");
const os = require("os");
const { ingestPayload } = require("../ingest");

const minioMock = {
  Client: function Client() {
    return {
      putObject: async () => {},
    };
  },
};

vi.mock("minio", () => minioMock);

const { syncToObjectStore } = require("../sync");
const { getSyncState } = require("../sync-log");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

describe("syncToObjectStore", () => {
  it("updates checkpoint after sync", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const config = {
      storage: {
        type: "minio",
        sqlite: { path: dbPath },
        minio: {
          bucket: "test",
          endpoint: "minio.local",
          accessKey: "key",
          secretKey: "secret",
          useSSL: false,
        },
      },
      capture: { response: true },
      sync: { enabled: true, userToken: "u1", deviceId: "d1", checkpoint: "" },
      queue: { maxBytes: 1024 * 1024 },
    };

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      source: "test",
      session_id: "s1",
      role: "user",
      text: "Hello sync",
      cli_name: "test",
    });

    ingestPayload(payload, config);
    await syncToObjectStore(config, { dryRun: false });

    const checkpoint = getSyncState(config);
    expect(checkpoint.lastSyncedAt).not.toBeNull();
  });
});

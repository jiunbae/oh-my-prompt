const fs = require("fs");
const path = require("path");
const os = require("os");
const { ingestPayload } = require("../ingest");
const { openDb } = require("../db");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

describe("ingestPayload", () => {
  it("writes a prompt record to sqlite", () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const config = {
      storage: { sqlite: { path: dbPath } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    };

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      source: "test-cli",
      session_id: "s1",
      role: "user",
      text: "Hello world",
      cli_name: "test-cli",
    });

    const result = ingestPayload(payload, config);
    expect(result.ok).toBe(true);

    const result2 = ingestPayload(payload, config);
    expect(result2.ok).toBe(true);

    const db = openDb(dbPath);
    const row = db.prepare("SELECT prompt_text, source FROM prompts LIMIT 1").get();
    const count = db.prepare("SELECT COUNT(*) as count FROM prompts").get();
    db.close();

    expect(row.prompt_text).toBe("Hello world");
    expect(row.source).toBe("test-cli");
    expect(count.count).toBe(1);
  });
});

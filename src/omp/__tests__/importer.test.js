const fs = require("fs");
const path = require("path");
const os = require("os");
const { importCodexHistory } = require("../importer");
const { openDb } = require("../db");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

describe("importCodexHistory", () => {
  it("imports codex history jsonl", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");
    const historyPath = path.join(root, "history.jsonl");

    const entry = {
      type: "agent-turn-complete",
      "thread-id": "t1",
      "turn-id": "1",
      cwd: "/tmp",
      "input-messages": ["Hello"],
      "last-assistant-message": "Hi there",
    };

    fs.writeFileSync(historyPath, JSON.stringify(entry) + "\n");

    const config = {
      storage: { sqlite: { path: dbPath } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    };

    const result = await importCodexHistory(config, { path: historyPath });
    expect(result.imported).toBe(1);

    const db = openDb(dbPath);
    const row = db.prepare("SELECT prompt_text, response_text FROM prompts LIMIT 1").get();
    db.close();

    expect(row.prompt_text).toBe("Hello");
    expect(row.response_text).toBe("Hi there");
  });
});

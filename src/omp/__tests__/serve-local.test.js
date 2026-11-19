const fs = require("fs");
const os = require("os");
const path = require("path");
const { startLocalServer } = require("../serve-local");
const { openDb } = require("../db");

function insertPrompt(db, id, text) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prompts (id, created_at, updated_at, source, session_id, role, prompt_text, prompt_length, project, cli_name)
     VALUES (?, ?, ?, 'claude-code', 's1', 'user', ?, ?, 'proj', 'claude')`
  ).run(id, now, now, text, text.length);
}

describe("omp serve --local", () => {
  const originalDriver = process.env.OMP_SQLITE_DRIVER;
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-serve-local-"));
    process.env.OMP_SQLITE_DRIVER = "sql.js";
  });

  afterEach(() => {
    if (originalDriver === undefined) delete process.env.OMP_SQLITE_DRIVER;
    else process.env.OMP_SQLITE_DRIVER = originalDriver;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("shows prompts captured after startup with the sql.js fallback", async () => {
    const dbPath = path.join(dir, "omp.db");
    const seed = await openDb(dbPath);
    expect(seed.driver).toBe("sql.js");
    insertPrompt(seed, "p-before", "captured before startup");
    seed.close();

    const config = { storage: { sqlite: { path: dbPath } } };
    const { server } = await startLocalServer(config, 0, { host: "127.0.0.1" });
    const { port } = server.address();
    try {
      const first = await (await fetch(`http://127.0.0.1:${port}/prompts`)).text();
      expect(first).toContain("captured before startup");

      const writer = await openDb(dbPath);
      insertPrompt(writer, "p-after", "captured after startup");
      writer.close();

      const second = await (await fetch(`http://127.0.0.1:${port}/prompts`)).text();
      expect(second).toContain("captured after startup");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

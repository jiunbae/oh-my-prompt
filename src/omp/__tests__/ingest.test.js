const fs = require("fs");
const path = require("path");
const os = require("os");
const { ingestPayload, replayQueue } = require("../ingest");
const { openDb } = require("../db");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

describe("ingestPayload", () => {
  it("redacts a payload before queueing it after a durable write failure", async () => {
    const root = makeTempRoot();
    const invalidDbPath = path.join(root, "database-directory");
    fs.mkdirSync(invalidDbPath);
    const config = {
      storage: { sqlite: { path: invalidDbPath } },
      capture: {
        response: true,
        redact: { enabled: true, mask: "[REDACTED]" },
      },
      queue: { maxBytes: 1024 * 1024 },
    };

    const result = await ingestPayload(
      {
        source: "test-cli",
        role: "user",
        text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      },
      config
    );

    expect(result.ok).toBe(false);
    const queueDir = path.join(root, "oh-my-prompt", "queue");
    const queued = fs.readFileSync(path.join(queueDir, fs.readdirSync(queueDir)[0]), "utf8");
    expect(queued).toContain("[REDACTED]");
    expect(queued).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("does not duplicate a queue file when replay fails again", async () => {
    const root = makeTempRoot();
    const invalidDbPath = path.join(root, "database-directory");
    fs.mkdirSync(invalidDbPath);
    const config = {
      storage: { sqlite: { path: invalidDbPath } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    };

    await ingestPayload({ source: "test", role: "user", text: "queued" }, config);
    const queueDir = path.join(root, "oh-my-prompt", "queue");
    expect(fs.readdirSync(queueDir)).toHaveLength(1);

    const replay = await replayQueue(config);
    expect(replay.failed).toBe(1);
    expect(fs.readdirSync(queueDir)).toHaveLength(1);
  });

  it("writes a prompt record to sqlite", async () => {
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

    const result = await ingestPayload(payload, config);
    expect(result.ok).toBe(true);

    const result2 = await ingestPayload(payload, config);
    expect(result2.ok).toBe(true);

    const db = await openDb(dbPath);
    const row = db.prepare("SELECT prompt_text, source FROM prompts LIMIT 1").get();
    const count = db.prepare("SELECT COUNT(*) as count FROM prompts").get();
    db.close();

    expect(row.prompt_text).toBe("Hello world");
    expect(row.source).toBe("test-cli");
    expect(count.count).toBe(1);
  });

  it("persists tool_invocations from a tools[] payload and derives Bash program", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const config = {
      storage: { sqlite: { path: dbPath } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    };

    // First: user prompt
    await ingestPayload(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "claude-code",
        session_id: "sess-tools",
        role: "user",
        text: "run tests",
        cli_name: "claude",
      }),
      config
    );

    // Then: assistant turn with tool_use blocks
    await ingestPayload(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "claude-code",
        session_id: "sess-tools",
        role: "assistant",
        text: "ok",
        user_prompt_text: "run tests",
        cli_name: "claude",
        capture_response: true,
        tools: [
          {
            tool_use_id: "tu_1",
            tool_name: "Bash",
            input: { command: "FOO=bar sudo /usr/bin/npm test --silent", description: "tests" },
            sequence: 0,
            cwd: "/tmp",
          },
          {
            tool_use_id: "tu_2",
            tool_name: "Edit",
            input: { file_path: "/tmp/x.js", old_string: "a", new_string: "b" },
            sequence: 1,
          },
        ],
      }),
      config
    );

    const db = await openDb(dbPath);
    const rows = db
      .prepare(
        "SELECT tool_name, program, tool_use_id, sequence, input_json FROM tool_invocations ORDER BY sequence"
      )
      .all();
    const promptCount = db.prepare("SELECT COUNT(*) as c FROM prompts").get();
    db.close();

    expect(promptCount.c).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].tool_name).toBe("Bash");
    expect(rows[0].program).toBe("npm");
    expect(rows[0].tool_use_id).toBe("tu_1");
    expect(rows[1].tool_name).toBe("Edit");
    expect(rows[1].program).toBeNull();
    const editInput = JSON.parse(rows[1].input_json);
    expect(editInput.file_path).toBe("/tmp/x.js");
  });

  it("upserts on duplicate (session_id, tool_use_id) without erroring", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const config = {
      storage: { sqlite: { path: dbPath } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    };

    const base = {
      timestamp: new Date().toISOString(),
      source: "claude-code",
      session_id: "sess-dup",
      role: "user",
      text: "do thing",
      cli_name: "claude",
      tools: [
        {
          tool_use_id: "tu_dup",
          tool_name: "Bash",
          input: { command: "git status" },
          sequence: 0,
        },
      ],
    };

    await ingestPayload(JSON.stringify(base), config);
    await ingestPayload(JSON.stringify(base), config);

    const db = await openDb(dbPath);
    const count = db.prepare("SELECT COUNT(*) as c FROM tool_invocations").get();
    db.close();
    expect(count.c).toBe(1);
  });

  it("rewrites the database once for a turn carrying many tool invocations", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");
    const config = {
      storage: { sqlite: { path: dbPath } },
      capture: { response: true },
      queue: { maxBytes: 1024 * 1024 },
    };

    // First ingest creates the schema; measure a steady-state turn after it.
    await ingestPayload(
      { source: "test", cli_name: "claude", role: "user", session_id: "s-warm", text: "warm" },
      config
    );

    const tools = Array.from({ length: 40 }, (_, i) => ({
      tool_use_id: `tu_${i}`,
      tool_name: "Bash",
      input: { command: `echo ${i}` },
      sequence: i,
    }));

    // sql.js serializes the whole database on every save, so a full-file
    // rewrite is exactly one renameSync onto the db path. Pre-transaction this
    // was one per tool call.
    const renameSpy = vi.spyOn(fs, "renameSync");
    const result = await ingestPayload(
      {
        source: "test",
        cli_name: "claude",
        role: "user",
        session_id: "s-tools",
        text: "turn with many tools",
        tools,
      },
      config
    );
    const rewrites = renameSpy.mock.calls.filter(([, dest]) => dest === dbPath).length;
    renameSpy.mockRestore();

    expect(result.ok).toBe(true);
    expect(rewrites).toBeLessThan(tools.length);
    expect(rewrites).toBeLessThanOrEqual(4);

    const db = await openDb(dbPath);
    const count = db.prepare("SELECT COUNT(*) as c FROM tool_invocations").get();
    db.close();
    expect(count.c).toBe(tools.length);
  });
});

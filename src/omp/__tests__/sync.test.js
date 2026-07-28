const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { ingestPayload } = require("../ingest");
const { syncToServer } = require("../sync");
const { getSyncState, getSyncStatus } = require("../sync-log");
const { openDb } = require("../db");

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-"));
  process.env.XDG_CONFIG_HOME = root;
  return root;
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

describe("syncToServer", () => {
  it("updates checkpoint after sync", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          accepted: parsed.records.length,
          duplicates: 0,
          rejected: 0,
          errors: [],
        }));
      });
    });

    try {
      const config = {
        server: {
          url: `http://127.0.0.1:${port}`,
          token: "test-token",
        },
        storage: {
          sqlite: { path: dbPath },
        },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", checkpoint: "" },
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

      await ingestPayload(payload, config);
      await syncToServer(config, { dryRun: false });

      const checkpoint = await getSyncState(config);
      expect(checkpoint.lastSyncedAt).not.toBeNull();

      const status = await getSyncStatus(config, 1);
      expect(status.recent[0]).not.toHaveProperty("user_token");
      const db = await openDb(dbPath);
      expect(db.prepare("SELECT user_token FROM sync_log LIMIT 1").get().user_token).toBeNull();
      db.close();
    } finally {
      server.close();
    }
  });

  it("does not advance the checkpoint when a 207 response rejects a record", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(207, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: false,
        accepted: 0,
        duplicates: 0,
        rejected: 1,
        errors: ["Invalid record event-1: created_at is not a valid date"],
      }));
    });

    try {
      const config = {
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", retries: 0 },
        queue: { maxBytes: 1024 * 1024 },
      };

      await ingestPayload(JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "test",
        session_id: "s-partial",
        role: "user",
        text: "Must not be skipped",
        cli_name: "test",
      }), config);

      await expect(syncToServer(config)).rejects.toThrow("Server rejected 1 record");

      const checkpoint = await getSyncState(config);
      expect(checkpoint.lastSyncedAt).toBeNull();
      expect(checkpoint.lastSyncedId).toBeNull();

      const status = await getSyncStatus(config, 1);
      expect(status.recent[0].status).toBe("failed");
    } finally {
      server.close();
    }
  });

  it("uploads tool_invocations alongside the parent prompt", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: 1, duplicates: 0, rejected: 0, errors: [] }));
      });
    });

    try {
      const config = {
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1" },
        queue: { maxBytes: 1024 * 1024 },
      };

      // user prompt
      await ingestPayload(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "claude-code",
          session_id: "sess-sync-tools",
          role: "user",
          text: "compile",
          cli_name: "claude",
        }),
        config
      );

      // assistant turn with two tool calls
      await ingestPayload(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "claude-code",
          session_id: "sess-sync-tools",
          role: "assistant",
          text: "done",
          user_prompt_text: "compile",
          cli_name: "claude",
          capture_response: true,
          tools: [
            { tool_use_id: "tu_A", tool_name: "Bash", input: { command: "npm run build" }, sequence: 0 },
            { tool_use_id: "tu_B", tool_name: "Read", input: { file_path: "/tmp/x" }, sequence: 1 },
          ],
        }),
        config
      );

      await syncToServer(config, { dryRun: false });

      expect(received.length).toBe(1);
      const records = received[0].records;
      expect(records.length).toBe(1);
      expect(Array.isArray(records[0].tools)).toBe(true);
      expect(records[0].tools).toHaveLength(2);
      const byId = Object.fromEntries(records[0].tools.map((t) => [t.tool_use_id, t]));
      expect(byId.tu_A.tool_name).toBe("Bash");
      expect(byId.tu_A.program).toBe("npm");
      expect(byId.tu_A.input.command).toBe("npm run build");
      expect(byId.tu_B.tool_name).toBe("Read");
    } finally {
      server.close();
    }
  });

  it("caps tools at 1000 per record so oversized records still upload", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        // Mirror the server-side schema: tools max 1000 per record
        if (parsed.records.some((r) => Array.isArray(r.tools) && r.tools.length > 1000)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request body" }));
          return;
        }
        received.push(parsed);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: parsed.records.length, duplicates: 0, rejected: 0, errors: [] }));
      });
    });

    try {
      const config = {
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", retries: 0 },
        queue: { maxBytes: 1024 * 1024 },
      };

      const tools = Array.from({ length: 1050 }, (_, i) => ({
        tool_use_id: `tu_${i}`,
        tool_name: "Bash",
        input: { command: `echo ${i}` },
        sequence: i,
      }));

      await ingestPayload(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "claude-code",
          session_id: "sess-many-tools",
          role: "assistant",
          text: "done",
          user_prompt_text: "long agentic run",
          cli_name: "claude",
          capture_response: true,
          tools,
        }),
        config
      );

      await syncToServer(config, { dryRun: false });

      expect(received.length).toBe(1);
      const record = received[0].records[0];
      expect(record.tools).toHaveLength(1000);
      // Keeps the earliest invocations by sequence
      expect(record.tools[0].tool_use_id).toBe("tu_0");
      expect(record.tools[999].tool_use_id).toBe("tu_999");
    } finally {
      server.close();
    }
  }, 30000);

  it("throws when server is not configured", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const config = {
      server: { url: "", token: "" },
      storage: {
        sqlite: { path: dbPath },
      },
      capture: { response: true },
      sync: { enabled: true, deviceId: "d1" },
      queue: { maxBytes: 1024 * 1024 },
    };

    await expect(syncToServer(config)).rejects.toThrow("Server not configured");
  });

  it("redacts secrets only on upload (keeps local DB raw)", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          accepted: 1,
          duplicates: 0,
          rejected: 0,
          errors: [],
        }));
      });
    });

    try {
      const config = {
        server: {
          url: `http://127.0.0.1:${port}`,
          token: "test-token",
        },
        storage: {
          sqlite: { path: dbPath },
        },
        // No local redaction: keep raw prompts in SQLite.
        capture: {
          response: true,
          redact: { enabled: false, mask: "[REDACTED]" },
        },
        // Upload redaction: sanitize only when syncing to server.
        sync: {
          enabled: true,
          deviceId: "d1",
          redact: { enabled: true, mask: "[REDACTED]" },
        },
        queue: { maxBytes: 1024 * 1024 },
      };

      const secret = "sk-123456789012345678901234567890";
      const payload = JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "test",
        session_id: "s1",
        role: "user",
        text: `Authorization: Bearer ${secret}`,
        cli_name: "test",
      });

      await ingestPayload(payload, config);

      const db = await require("../db").openDb(dbPath);
      const row = db.prepare("SELECT prompt_text FROM prompts LIMIT 1").get();
      db.close();
      expect(row.prompt_text).toContain(secret);

      await syncToServer(config, { dryRun: false });

      expect(received.length).toBe(1);
      expect(received[0].records.length).toBe(1);
      const uploadedText = received[0].records[0].prompt_text;
      expect(uploadedText).toContain("Authorization: Bearer");
      expect(uploadedText).toContain("[REDACTED]");
      expect(uploadedText).not.toContain(secret);
      expect(uploadedText).not.toContain("sk-");
    } finally {
      server.close();
    }
  });
});

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

  it("waits out a 429 and completes the sync instead of aborting", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    let calls = 0;
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        calls++;
        if (calls === 1) {
          res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" });
          res.end(JSON.stringify({ error: "Too many requests" }));
          return;
        }
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
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", retries: 0 },
        queue: { maxBytes: 1024 * 1024 },
      };

      await ingestPayload(JSON.stringify({
        timestamp: new Date().toISOString(),
        source: "test",
        session_id: "s-429",
        role: "user",
        text: "Survives throttling",
        cli_name: "test",
      }), config);

      const result = await syncToServer(config);

      expect(calls).toBe(2);
      expect(result.uploaded).toBe(1);
      const checkpoint = await getSyncState(config);
      expect(checkpoint.lastSyncedAt).not.toBeNull();
    } finally {
      server.close();
    }
  }, 15000);

  it("keeps the checkpoint of chunks accepted before a later chunk fails", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    let calls = 0;
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        calls++;
        if (calls === 1) {
          const parsed = JSON.parse(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            accepted: parsed.records.length,
            duplicates: 0,
            rejected: 0,
            errors: [],
          }));
          return;
        }
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "0" });
        res.end(JSON.stringify({ error: "Too many requests" }));
      });
    });

    try {
      const config = {
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", retries: 0, rateLimitRetries: 1 },
        queue: { maxBytes: 1024 * 1024 },
      };

      const first = new Date(Date.now() - 60000).toISOString();
      const second = new Date().toISOString();
      for (const [ts, text] of [[first, "first"], [second, "second"]]) {
        await ingestPayload(JSON.stringify({
          timestamp: ts,
          source: "test",
          session_id: "s-partial-429",
          role: "user",
          text,
          cli_name: "test",
        }), config);
      }

      await expect(syncToServer(config, { chunkSize: 1 })).rejects.toThrow("Rate limited");

      // Chunk 1 was accepted, so its checkpoint survives the failure of chunk 2.
      const checkpoint = await getSyncState(config);
      expect(checkpoint.lastSyncedAt).toBe(first);
    } finally {
      server.close();
    }
  }, 15000);

  it("never moves the checkpoint backwards for backfilled rows", async () => {
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
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d1", retries: 0 },
        queue: { maxBytes: 1024 * 1024 },
      };

      const older = new Date(Date.now() - 60000).toISOString();
      const newer = new Date().toISOString();
      for (const [ts, text] of [[older, "older"], [newer, "newer"]]) {
        await ingestPayload(JSON.stringify({
          timestamp: ts,
          source: "test",
          session_id: "s-backfill",
          role: "user",
          text,
          cli_name: "test",
        }), config);
      }

      await syncToServer(config, { chunkSize: 1 });
      expect((await getSyncState(config)).lastSyncedAt).toBe(newer);

      // A later Stop hook attaches a response to the OLDER prompt. fetchRows
      // returns it ahead of everything else because it sorts by created_at.
      const db = await openDb(dbPath);
      const updatedAt = new Date(Date.now() + 60000).toISOString();
      db.prepare(
        "UPDATE prompts SET response_text = ?, updated_at = ? WHERE prompt_text = ?"
      ).run("backfilled answer", updatedAt, "older");
      db.close();

      await syncToServer(config, { chunkSize: 1 });

      // The backfilled row uploads and advances to its update time, never back
      // to created_at. This also prevents resending the same update forever.
      const after = await getSyncState(config);
      expect(after.lastSyncedAt).toBe(updatedAt);
    } finally {
      server.close();
    }
  }, 15000);

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

  it("uploads a backlog larger than one page across successive pages", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        received.push(parsed);
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
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d-page", checkpoint: "" },
        queue: { maxBytes: 1024 * 1024 },
      };

      const total = 7;
      for (let i = 0; i < total; i++) {
        await ingestPayload(
          JSON.stringify({
            timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
            source: "test-cli",
            session_id: "s-page",
            role: "user",
            text: `paged prompt ${i}`,
            cli_name: "test",
            turn_index: i,
          }),
          config
        );
      }

      // Dry runs must use the same keyset cursor even though they do not persist
      // a checkpoint between pages.
      const dryRun = await syncToServer(config, {
        dryRun: true,
        maxRowsPerPage: 2,
        chunkSize: 2,
      });
      expect(dryRun.uploaded).toBe(total);
      expect(received).toHaveLength(0);

      // Two rows per page forces the outer paging loop to run several times.
      const result = await syncToServer(config, {
        maxRowsPerPage: 2,
        chunkSize: 2,
      });

      expect(result.uploaded).toBe(total);
      const uploadedTexts = received.flatMap((r) => r.records.map((x) => x.prompt_text));
      expect(new Set(uploadedTexts).size).toBe(total);
      expect(received.length).toBeGreaterThan(1);
    } finally {
      server.close();
    }
  });

  it("keeps paging when every row shares one timestamp and the run started with no checkpoint", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        received.push(parsed);
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
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d-same-ts", checkpoint: "" },
        queue: { maxBytes: 1024 * 1024 },
      };

      // One shared timestamp is the worst case for a created_at predicate: once
      // page one persists a checkpoint at that instant, `created_at > since`
      // excludes every remaining row. The run must keep its starting predicate
      // — here "no lower bound at all" — for the whole traversal, and rely on
      // the keyset cursor to advance.
      const timestamp = new Date(Date.UTC(2026, 0, 1)).toISOString();
      const total = 9;
      for (let i = 0; i < total; i++) {
        await ingestPayload(
          JSON.stringify({
            timestamp,
            source: "test-cli",
            session_id: "s-same-ts",
            role: "user",
            text: `same instant ${i}`,
            cli_name: "test",
            turn_index: i,
          }),
          config
        );
      }

      const result = await syncToServer(config, { maxRowsPerPage: 2, chunkSize: 1 });

      expect(result.uploaded).toBe(total);
      const uploadedTexts = received.flatMap((r) => r.records.map((x) => x.prompt_text));
      expect(new Set(uploadedTexts).size).toBe(total);
    } finally {
      server.close();
    }
  });

  it("pages past updated historical rows that cannot advance the checkpoint", async () => {
    const root = makeTempRoot();
    const dbPath = path.join(root, "omp.db");

    const received = [];
    const { server, port } = await startMockServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        received.push(...parsed.records);
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
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d-historical-pages", checkpoint: "" },
        queue: { maxBytes: 1024 * 1024 },
      };

      const historicalCount = 5;
      for (let i = 0; i < historicalCount; i++) {
        await ingestPayload(
          {
            timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
            source: "test-cli",
            session_id: "s-historical-pages",
            role: "user",
            text: `historical ${i}`,
            cli_name: "test",
            turn_index: i,
          },
          config
        );
      }

      await syncToServer(config, { maxRowsPerPage: 2, chunkSize: 2 });
      received.length = 0;

      // All of these rows now match the updated_at arm of fetchRows, but their
      // created_at values are behind the durable checkpoint.
      const db = await openDb(dbPath);
      const updatedAt = new Date(Date.UTC(2026, 1, 1)).toISOString();
      db.transaction(() => {
        db.prepare(
          "UPDATE prompts SET response_text = ?, updated_at = ? WHERE prompt_text = ?"
        ).run("late response", updatedAt, "historical 0");
        for (let i = 1; i < historicalCount; i++) {
          db.prepare(
            "UPDATE prompts SET response_text = ?, updated_at = ? WHERE prompt_text = ?"
          ).run(`late response ${i}`, updatedAt, `historical ${i}`);
        }
      })();
      db.close();

      await ingestPayload(
        {
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 1, 0)).toISOString(),
          source: "test-cli",
          session_id: "s-historical-pages",
          role: "user",
          text: "new after checkpoint",
          cli_name: "test",
          turn_index: historicalCount,
        },
        config
      );

      const result = await syncToServer(config, {
        maxRowsPerPage: 2,
        chunkSize: 2,
      });

      expect(result.uploaded).toBe(historicalCount + 1);
      expect(new Set(received.map((record) => record.prompt_text))).toEqual(
        new Set([
          ...Array.from({ length: historicalCount }, (_, i) => `historical ${i}`),
          "new after checkpoint",
        ])
      );

      received.length = 0;
      const repeated = await syncToServer(config, {
        maxRowsPerPage: 2,
        chunkSize: 2,
      });
      expect(repeated.uploaded).toBe(0);
      expect(received).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it("persists one checkpoint per page instead of rewriting for every upload chunk", async () => {
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
        server: { url: `http://127.0.0.1:${port}`, token: "test-token" },
        storage: { sqlite: { path: dbPath } },
        capture: { response: true },
        sync: { enabled: true, deviceId: "d-page-checkpoint" },
        queue: { maxBytes: 1024 * 1024 },
      };
      for (let i = 0; i < 5; i++) {
        await ingestPayload(
          {
            timestamp: new Date(Date.UTC(2026, 2, 1, 0, 0, i)).toISOString(),
            source: "test-cli",
            session_id: "s-page-checkpoint",
            role: "user",
            text: `checkpoint ${i}`,
            cli_name: "test",
            turn_index: i,
          },
          config
        );
      }

      const renameSpy = vi.spyOn(fs, "renameSync");
      const result = await syncToServer(config, {
        maxRowsPerPage: 5,
        chunkSize: 1,
      });
      const rewrites = renameSpy.mock.calls.filter(([, dest]) => dest === dbPath).length;
      renameSpy.mockRestore();

      expect(result.uploaded).toBe(5);
      // One sync-log start, one page checkpoint, one sync-log finish.
      expect(rewrites).toBe(3);
    } finally {
      server.close();
    }
  });
});

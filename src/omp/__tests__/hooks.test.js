const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const {
  installCodexHook,
  uninstallCodexHook,
  installGeminiHook,
  uninstallGeminiHook,
  installOpenCodeHook,
  uninstallOpenCodeHook,
  listHookStatus,
} = require("../hooks");

function withTempEnv(run) {
  const original = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    OPENCODE_CONFIG_HOME: process.env.OPENCODE_CONFIG_HOME,
  };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-hooks-"));
  const xdgConfigHome = path.join(root, ".config");
  const codexHome = path.join(root, ".codex");
  const opencodeConfigHome = path.join(xdgConfigHome, "opencode");

  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.CODEX_HOME = codexHome;
  process.env.OPENCODE_CONFIG_HOME = opencodeConfigHome;

  fs.mkdirSync(xdgConfigHome, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(opencodeConfigHome, { recursive: true });

  try {
    run({ root, xdgConfigHome, codexHome, opencodeConfigHome });
  } finally {
    process.env.XDG_CONFIG_HOME = original.XDG_CONFIG_HOME;
    process.env.CODEX_HOME = original.CODEX_HOME;
    process.env.OPENCODE_CONFIG_HOME = original.OPENCODE_CONFIG_HOME;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("hooks", () => {
  it("merges and restores codex notify config when original notify is a string command", () => {
    withTempEnv(({ codexHome }) => {
      const codexConfigPath = path.join(codexHome, "config.toml");
      fs.writeFileSync(codexConfigPath, 'notify = "echo codex-notify"\n');

      const installResult = installCodexHook();
      expect(installResult.configured).toBe(true);
      expect(installResult.conflict).toBe(false);
      expect(installResult.merged).toBe(true);

      const installedConfig = fs.readFileSync(codexConfigPath, "utf-8");
      expect(installedConfig).toContain(installResult.wrapperPath);

      const chain = JSON.parse(fs.readFileSync(installResult.chainPath, "utf-8"));
      expect(chain.original).toBe("echo codex-notify");

      const notifyScript = fs.readFileSync(installResult.scriptPath, "utf-8");
      expect(notifyScript).toContain("event_id:");
      expect(notifyScript).toContain("codex:");

      const uninstallResult = uninstallCodexHook();
      expect(uninstallResult.restored).toBe(true);

      const restoredConfig = fs.readFileSync(codexConfigPath, "utf-8");
      expect(restoredConfig).toContain('notify = "echo codex-notify"');
    });
  });

  it("codex notify script tails the rollout for function_call entries and emits tools[]", () => {
    withTempEnv(({ root, codexHome }) => {
      const installResult = installCodexHook();
      const scriptPath = installResult.scriptPath;

      const threadId = "thr-test-12345";
      const turnId = "turn-abc";

      // Fake rollout file under ~/.codex/sessions/2026/05/14/rollout-...-<threadId>.jsonl
      const sessionsDir = path.join(codexHome, "sessions", "2026", "05", "14");
      fs.mkdirSync(sessionsDir, { recursive: true });
      const rolloutPath = path.join(sessionsDir, "rollout-2026-05-14T00-00-00-" + threadId + ".jsonl");
      const lines = [
        { timestamp: "2026-05-14T00:00:00Z", type: "session_meta", payload: { id: threadId } },
        { timestamp: "2026-05-14T00:00:01Z", type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
        { timestamp: "2026-05-14T00:00:02Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: "ls -la" }), call_id: "call_x" } },
        { timestamp: "2026-05-14T00:00:03Z", type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ patch: "*** Begin" }), call_id: "call_y" } },
        { timestamp: "2026-05-14T00:00:04Z", type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      ];
      fs.writeFileSync(rolloutPath, lines.map((o) => JSON.stringify(o)).join("\n") + "\n");

      // Fake omp binary captures stdin to a file.
      const capturePath = path.join(root, "captured.json");
      const fakeOmpDir = path.join(root, "bin");
      fs.mkdirSync(fakeOmpDir, { recursive: true });
      const fakeOmp = path.join(fakeOmpDir, "omp");
      fs.writeFileSync(
        fakeOmp,
        "#!/usr/bin/env node\nconst fs = require('fs');\nlet buf='';\nprocess.stdin.on('data',d=>buf+=d);\nprocess.stdin.on('end',()=>{fs.writeFileSync(process.env.CAPTURE_PATH, buf);});\n"
      );
      fs.chmodSync(fakeOmp, 0o755);

      const event = {
        type: "agent-turn-complete",
        "thread-id": threadId,
        "turn-id": turnId,
        "input-messages": ["hello"],
        "last-assistant-message": "world",
        cwd: "/tmp",
        model: "gpt-5",
      };

      const result = spawnSync("node", [scriptPath, JSON.stringify(event)], {
        env: { ...process.env, CODEX_HOME: codexHome, OMP_BIN: fakeOmp, CAPTURE_PATH: capturePath },
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(capturePath)).toBe(true);
      const captured = JSON.parse(fs.readFileSync(capturePath, "utf-8"));
      expect(captured.session_id).toBe(threadId);
      expect(Array.isArray(captured.tools)).toBe(true);
      expect(captured.tools).toHaveLength(2);
      const byId = Object.fromEntries(captured.tools.map((t) => [t.tool_use_id, t]));
      expect(byId.call_x.tool_name).toBe("shell");
      expect(byId.call_x.input.command).toBe("ls -la");
      expect(byId.call_y.tool_name).toBe("apply_patch");

      uninstallCodexHook();
    });
  });

  // Regression: every step below failed in shipped installs while `omp status`
  // still reported codex=installed, so nothing was ever captured.
  it("chains a resident codex notify without blocking its own capture", () => {
    withTempEnv(({ root, codexHome }) => {
      // A chained notify that never exits — the Codex Computer Use client behaves
      // this way. Waiting on it would strand the wrapper before it ingests.
      const residentDir = path.join(root, "resident");
      fs.mkdirSync(residentDir, { recursive: true });
      const chainedMarker = path.join(root, "chained-ran");
      const residentCmd = path.join(residentDir, "resident-notify");
      fs.writeFileSync(residentCmd, `#!/bin/sh\ntouch ${JSON.stringify(chainedMarker)}\nsleep 20\n`);
      fs.chmodSync(residentCmd, 0o755);

      // Codex spells notify as a multi-line array with a trailing comma.
      const codexConfigPath = path.join(codexHome, "config.toml");
      fs.writeFileSync(
        codexConfigPath,
        ["notify = [", `    ${JSON.stringify(residentCmd)},`, '    "turn-ended",', "]", ""].join("\n")
      );

      const installResult = installCodexHook();
      expect(installResult.merged).toBe(true);

      // The original notify must survive as argv, not as raw TOML text.
      const chain = JSON.parse(fs.readFileSync(installResult.chainPath, "utf-8"));
      expect(chain.original).toEqual([residentCmd, "turn-ended"]);

      // Codex spawns notify directly, so a bare "node" may not resolve.
      const installedConfig = fs.readFileSync(codexConfigPath, "utf-8");
      expect(installedConfig).toContain(`notify = ["${process.execPath}"`);

      const capturePath = path.join(root, "wrapper-captured.json");
      const fakeOmp = path.join(root, "bin-wrapper", "omp");
      fs.mkdirSync(path.dirname(fakeOmp), { recursive: true });
      fs.writeFileSync(
        fakeOmp,
        "#!/usr/bin/env node\nconst fs = require('fs');\nlet buf='';\nprocess.stdin.on('data',d=>buf+=d);\nprocess.stdin.on('end',()=>{fs.writeFileSync(process.env.CAPTURE_PATH, buf);});\n"
      );
      fs.chmodSync(fakeOmp, 0o755);

      const event = {
        type: "agent-turn-complete",
        "thread-id": "thr-wrapper",
        "turn-id": "turn-wrapper",
        "input-messages": ["hi"],
        "last-assistant-message": "there",
      };

      const startedAt = process.hrtime.bigint();
      const result = spawnSync(process.execPath, [installResult.wrapperPath, JSON.stringify(event)], {
        env: { ...process.env, CODEX_HOME: codexHome, OMP_BIN: fakeOmp, CAPTURE_PATH: capturePath },
        encoding: "utf-8",
        timeout: 15000,
      });
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      expect(result.status).toBe(0);
      // Blocking on the 20s resident command would blow well past this.
      expect(elapsedMs).toBeLessThan(8000);

      const captured = JSON.parse(fs.readFileSync(capturePath, "utf-8"));
      expect(captured.session_id).toBe("thr-wrapper");
      expect(captured.text).toBe("hi");

      // The chained command still has to actually run.
      expect(fs.existsSync(chainedMarker)).toBe(true);

      uninstallCodexHook();
      const restoredConfig = fs.readFileSync(codexConfigPath, "utf-8");
      expect(restoredConfig).toContain(residentCmd);
      expect(restoredConfig).toContain("turn-ended");
    });
  });

  it("repoints an older bare-node notify line without re-chaining it", () => {
    withTempEnv(({ codexHome }) => {
      const codexConfigPath = path.join(codexHome, "config.toml");
      const first = installCodexHook();

      // Simulate what earlier versions wrote.
      fs.writeFileSync(codexConfigPath, `notify = ["node", ${JSON.stringify(first.scriptPath)}]\n`);

      const second = installCodexHook();
      expect(second.configured).toBe(true);
      expect(second.merged).toBe(false);

      const config = fs.readFileSync(codexConfigPath, "utf-8");
      expect(config).toContain(`notify = ["${process.execPath}", ${JSON.stringify(first.scriptPath)}]`);
      // Our own line must never be captured as a chained "original".
      expect(fs.existsSync(second.chainPath)).toBe(false);

      uninstallCodexHook();
    });
  });

  it("gemini hook script mines toolCalls from the chat session JSON and emits tools[]", () => {
    withTempEnv(({ root, codexHome }) => {
      const geminiHome = path.join(root, ".gemini");
      fs.mkdirSync(geminiHome, { recursive: true });
      const prevGeminiHome = process.env.GEMINI_HOME;
      process.env.GEMINI_HOME = geminiHome;

      try {
        const installResult = installGeminiHook();
        const scriptPath = installResult.scriptPath;

        const sessionId = "abc12345-aaaa-bbbb-cccc-dddddddddddd";
        const shortPrefix = sessionId.split("-")[0];

        // Fake chat session file. Filename includes shortPrefix so the scanner picks it up.
        const projHash = "fakeprojhash";
        const chatsDir = path.join(geminiHome, "tmp", projHash, "chats");
        fs.mkdirSync(chatsDir, { recursive: true });
        const sessionFile = path.join(chatsDir, "session-2026-05-14T00-00-" + shortPrefix + ".json");
        fs.writeFileSync(
          sessionFile,
          JSON.stringify({
            sessionId,
            projectHash: projHash,
            messages: [
              { id: "u1", type: "user", content: "do thing" },
              {
                id: "g1",
                type: "gemini",
                content: "I'll read the file then write it.",
                toolCalls: [
                  { id: "read_file-1-aaa", name: "read_file", args: { file_path: "/tmp/x" } },
                  { id: "write_file-2-bbb", name: "write_file", args: { file_path: "/tmp/x", content: "hi" } },
                ],
              },
            ],
          })
        );

        const capturePath = path.join(root, "captured-gemini.json");
        const fakeOmpDir = path.join(root, "bin-gemini");
        fs.mkdirSync(fakeOmpDir, { recursive: true });
        const fakeOmp = path.join(fakeOmpDir, "omp");
        fs.writeFileSync(
          fakeOmp,
          "#!/usr/bin/env node\nconst fs = require('fs');\nlet buf='';\nprocess.stdin.on('data',d=>buf+=d);\nprocess.stdin.on('end',()=>{fs.writeFileSync(process.env.CAPTURE_PATH, buf);});\n"
        );
        fs.chmodSync(fakeOmp, 0o755);

        const hookPayload = JSON.stringify({
          session_id: sessionId,
          cwd: "/tmp",
          prompt: "do thing",
          response: "ok",
          hook_event_name: "AfterAgent",
        });

        const result = spawnSync("bash", [scriptPath], {
          input: hookPayload,
          env: { ...process.env, GEMINI_HOME: geminiHome, OMP_BIN: fakeOmp, CAPTURE_PATH: capturePath },
          encoding: "utf-8",
        });

        expect(result.status).toBe(0);
        expect(fs.existsSync(capturePath)).toBe(true);
        const captured = JSON.parse(fs.readFileSync(capturePath, "utf-8"));
        expect(captured.session_id).toBe(sessionId);
        expect(Array.isArray(captured.tools)).toBe(true);
        expect(captured.tools).toHaveLength(2);
        const byId = Object.fromEntries(captured.tools.map((t) => [t.tool_use_id, t]));
        expect(byId["read_file-1-aaa"].tool_name).toBe("read_file");
        expect(byId["read_file-1-aaa"].input.file_path).toBe("/tmp/x");
        expect(byId["write_file-2-bbb"].tool_name).toBe("write_file");

        uninstallGeminiHook();
      } finally {
        process.env.GEMINI_HOME = prevGeminiHome;
      }
    });
  });

  it("opencode plugin collects tool parts and forwards tools[] to omp ingest", async () => {
    let tempRoot;
    let prevOmp;
    try {
      // Manually set up env (withTempEnv is sync-only)
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-opencode-e2e-"));
      const xdgConfigHome = path.join(tempRoot, ".config");
      const opencodeConfigHome = path.join(xdgConfigHome, "opencode");
      fs.mkdirSync(opencodeConfigHome, { recursive: true });
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      process.env.OPENCODE_CONFIG_HOME = opencodeConfigHome;

      const installResult = installOpenCodeHook();
      const scriptPath = installResult.scriptPath;

      // Fake omp binary that captures stdin
      const capturePath = path.join(tempRoot, "captured-opencode.json");
      const fakeOmpDir = path.join(tempRoot, "bin-opencode");
      fs.mkdirSync(fakeOmpDir, { recursive: true });
      const fakeOmp = path.join(fakeOmpDir, "omp");
      fs.writeFileSync(
        fakeOmp,
        "#!/usr/bin/env node\nconst fs = require('fs');\nlet buf='';\nprocess.stdin.on('data',d=>buf+=d);\nprocess.stdin.on('end',()=>{fs.writeFileSync(process.env.CAPTURE_PATH, buf);});\n"
      );
      fs.chmodSync(fakeOmp, 0o755);

      prevOmp = process.env.OMP_BIN;
      process.env.OMP_BIN = fakeOmp;
      process.env.CAPTURE_PATH = capturePath;

      // Dynamic-import the generated ESM plugin
      const plugin = (await import(pathToFileURL(scriptPath).href)).default;

      const sessionID = "sess-oc-test";
      const messages = [
        {
          info: { id: "u1", role: "user", path: { cwd: "/tmp/oc", root: "/tmp/oc" } },
          parts: [{ type: "text", text: "do build" }],
        },
        {
          info: {
            id: "g1",
            role: "assistant",
            parentID: "u1",
            path: { cwd: "/tmp/oc", root: "/tmp/oc" },
            providerID: "anthropic",
            modelID: "claude-sonnet",
          },
          parts: [
            { type: "text", text: "Sure, running build." },
            { type: "tool", callID: "call_ls", tool: "bash", state: { input: { command: "ls /tmp" } } },
            { type: "tool", callID: "call_read", tool: "read", state: { input: { filePath: "/tmp/x" } } },
          ],
        },
      ];

      const fakeCtx = {
        client: { session: { messages: async () => messages } },
        directory: "/tmp/oc",
      };

      const handlers = await plugin(fakeCtx);
      await handlers.event({ event: { type: "session.idle", properties: { sessionID } } });

      // spawnSync writes capture file synchronously inside the fake omp script's
      // 'end' handler; small wait to let the child process finalize the write.
      const start = Date.now();
      while (!fs.existsSync(capturePath) && Date.now() - start < 2000) {
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(fs.existsSync(capturePath)).toBe(true);
      const captured = JSON.parse(fs.readFileSync(capturePath, "utf-8"));
      expect(captured.session_id).toBe(sessionID);
      expect(Array.isArray(captured.tools)).toBe(true);
      expect(captured.tools).toHaveLength(2);
      const byId = Object.fromEntries(captured.tools.map((t) => [t.tool_use_id, t]));
      expect(byId.call_ls.tool_name).toBe("bash");
      expect(byId.call_ls.input.command).toBe("ls /tmp");
      expect(byId.call_read.tool_name).toBe("read");

      uninstallOpenCodeHook();
    } finally {
      if (prevOmp !== undefined) process.env.OMP_BIN = prevOmp;
      else delete process.env.OMP_BIN;
      delete process.env.CAPTURE_PATH;
      if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("installs and uninstalls opencode plugin hook", () => {
    withTempEnv(({ opencodeConfigHome }) => {
      const installResult = installOpenCodeHook();
      expect(installResult.configured).toBe(true);
      expect(installResult.conflict).toBe(false);
      expect(fs.existsSync(installResult.scriptPath)).toBe(true);

      const opencodeConfigPath = path.join(opencodeConfigHome, "opencode.json");
      const opencodeConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf-8"));
      expect(Array.isArray(opencodeConfig.plugin)).toBe(true);
      expect(opencodeConfig.plugin).toContain(installResult.scriptPath);

      // OpenCode config may use file URL form; status/uninstall should still work.
      opencodeConfig.plugin = [pathToFileURL(installResult.scriptPath).href];
      fs.writeFileSync(opencodeConfigPath, JSON.stringify(opencodeConfig, null, 2) + "\n");
      const installedStatus = listHookStatus();
      expect(installedStatus.opencode).toBe(true);

      const uninstallResult = uninstallOpenCodeHook();
      expect(uninstallResult.removed).toBe(true);

      const updatedConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, "utf-8"));
      expect(updatedConfig.plugin).not.toContain(installResult.scriptPath);
      expect(listHookStatus().opencode).toBe(false);
    });
  });
});

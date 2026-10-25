const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { installClaudeHook } = require("../hooks");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-claude-tail-"));
  const home = vi.spyOn(os, "homedir").mockReturnValue(root);
  let script;
  try {
    installClaudeHook();
    script = fs.readFileSync(path.join(root, ".claude/hooks/stop-capture.sh"), "utf8");
  } finally {
    home.mockRestore();
  }
  const parser = script.split("<< 'NODESCRIPT'\n")[1].split("\nNODESCRIPT")[0];
  const transcript = path.join(root, "transcript.jsonl");
  return {
    root, transcript, hook: path.join(root, ".claude/hooks/stop-capture.sh"),
    run() {
      const result = spawnSync(process.execPath, ["--max-old-space-size=64", "-e", parser], {
        encoding: "utf8", timeout: 15000,
        env: {
          ...process.env,
          OMP_PAYLOAD: JSON.stringify({ hook_event_name: "Stop", session_id: "test", transcript_path: transcript }),
          XDG_CACHE_HOME: path.join(root, "cache"),
        },
      });
      // First line is the snapshot size for the shell's post-ingest ack.
      return { ...result, stdout: result.stdout?.split("\n").slice(1).join("\n") };
    },
  };
}

describe("Claude Stop transcript parsing", () => {
  it("retries failed ingest and checkpoints only the captured snapshot after success", async () => {
    const f = fixture();
    const modePath = path.join(f.root, "mode");
    const capturePath = path.join(f.root, "capture.json");
    const checkpoint = path.join(f.root, "cache/omp/checkpoints/test.json");
    const fakeOmp = path.join(f.root, "omp");
    async function waitFor(check) {
      const deadline = Date.now() + 3000;
      while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for Stop capture");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    function runHook() {
      const result = spawnSync("bash", [f.hook], {
        input: JSON.stringify({ hook_event_name: "Stop", session_id: "test", transcript_path: f.transcript }),
        encoding: "utf8", timeout: 3000,
        env: { ...process.env, OMP_BIN: fakeOmp, XDG_CACHE_HOME: path.join(f.root, "cache") },
      });
      expect(result.status, result.stderr).toBe(0);
    }
    try {
      fs.writeFileSync(f.transcript, [
        { type: "user", content: "run tests" },
        { type: "assistant", content: "done" },
      ].map(row => JSON.stringify(row)).join("\n") + "\n");
      const snapshotSize = fs.statSync(f.transcript).size;
      fs.writeFileSync(fakeOmp, `#!/usr/bin/env node
const fs = require('fs');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const mode = fs.readFileSync(${JSON.stringify(modePath)}, 'utf8');
  if (mode === 'append') fs.appendFileSync(${JSON.stringify(f.transcript)}, JSON.stringify({type:'assistant',content:'late response'}) + '\\n');
  fs.writeFileSync(${JSON.stringify(capturePath)}, input);
  process.exit(mode === 'fail' ? 1 : 0);
});
`, { mode: 0o700 });
      fs.writeFileSync(modePath, "fail");
      runHook();
      await waitFor(() => fs.existsSync(capturePath));
      expect(JSON.parse(fs.readFileSync(capturePath, "utf8")).text).toBe("done");
      expect(fs.existsSync(checkpoint)).toBe(false);

      fs.unlinkSync(capturePath);
      fs.writeFileSync(modePath, "append");
      runHook();
      await waitFor(() => fs.existsSync(checkpoint));
      expect(JSON.parse(fs.readFileSync(checkpoint, "utf8")).size).toBe(snapshotSize);
      expect(fs.statSync(f.transcript).size).toBeGreaterThan(snapshotSize);

      fs.writeFileSync(modePath, "success");
      runHook();
      await waitFor(() => JSON.parse(fs.readFileSync(checkpoint, "utf8")).size === fs.statSync(f.transcript).size);
      expect(JSON.parse(fs.readFileSync(capturePath, "utf8")).text).toBe("done\n\nlate response");
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("preserves the latest turn, Unicode across chunks and tool order while clipping inputs", () => {
    const f = fixture();
    try {
      const prompt = "요청🙂".repeat(20000);
      const rows = [
        { type: "user", content: "previous turn" },
        { type: "assistant", content: "previous response" },
        { type: "user", message: { content: [{ type: "text", text: prompt }] } },
        { type: "assistant", cwd: "/project", message: { content: [
          { type: "thinking", thinking: "private reasoning".repeat(20000) },
          { type: "text", text: "first response" },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "x".repeat(100000) } },
        ] } },
        { type: "user", message: { content: [{ type: "tool_result", content: "output".repeat(20000) }] } },
        { type: "assistant", content: [{ type: "text", text: "last response" },
          { type: "tool_use", id: "tool-2", name: "Read", input: { file_path: "file" } }] },
      ];
      // Deliberately omit the trailing newline.
      fs.writeFileSync(f.transcript, rows.map(row => JSON.stringify(row)).join("\n"));
      const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      const captured = JSON.parse(result.stdout);
      expect(captured.user_prompt_text).toBe(prompt);
      expect(captured.text).toBe("first response\n\nlast response");
      expect(captured.cwd).toBe("/project");
      expect(captured.tools.map(tool => tool.tool_use_id)).toEqual(["tool-1", "tool-2"]);
      expect(captured.tools.map(tool => tool.sequence)).toEqual([0, 1]);
      expect(captured.tools[0].input.command).toBe("x".repeat(32768) + "...[truncated 67232 chars]");
      expect(fs.existsSync(path.join(f.root, "cache/omp/checkpoints/test.json"))).toBe(false);
      expect(JSON.parse(f.run().stdout)).toEqual(captured); // not acknowledged yet
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("parses a turn with 96 MiB of tool output within a 64 MiB JS heap", () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.transcript, JSON.stringify({ type: "user", content: "run tests" }) + "\n");
      const toolResult = JSON.stringify({ type: "user", message: { content: [
        { type: "tool_result", content: "x".repeat(1024 * 1024) },
      ] } }) + "\n";
      for (let i = 0; i < 96; i++) fs.appendFileSync(f.transcript, toolResult);
      fs.appendFileSync(f.transcript, JSON.stringify({ type: "assistant", content: "done" }) + "\n");
      const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).text).toBe("done");
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
});

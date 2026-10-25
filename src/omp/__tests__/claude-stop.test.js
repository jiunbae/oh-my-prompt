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
    root, transcript,
    run() {
      return spawnSync(process.execPath, ["--max-old-space-size=64", "-e", parser], {
        encoding: "utf8", timeout: 15000,
        env: {
          ...process.env,
          OMP_PAYLOAD: JSON.stringify({ hook_event_name: "Stop", session_id: "test", transcript_path: transcript }),
          XDG_CACHE_HOME: path.join(root, "cache"),
        },
      });
    },
  };
}

describe("Claude Stop transcript parsing", () => {
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
      expect(f.run().stdout).toBe(""); // unchanged transcript checkpoint
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

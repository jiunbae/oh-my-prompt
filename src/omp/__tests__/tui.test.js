const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { openDb } = require("../db");
const {
  loadPrompts,
  searchPrompts,
  getPromptCount,
  toggleFavorite,
  deletePrompt,
  copyToClipboard,
} = require("../tui");

describe("local TUI data operations", () => {
  it("loads, favorites, searches, and deletes prompts against the current schema", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-tui-"));
    const db = await openDb(path.join(root, "omp.db"));
    const now = "2026-08-10T00:00:00.000Z";
    db.prepare(
      `INSERT INTO prompts (
         id, event_id, created_at, updated_at, source, session_id, role,
         prompt_text, prompt_length, project, cli_name, capture_response
       ) VALUES ('tui-1', 'tui-event-1', ?, ?, 'test', 'session', 'user',
                 'interactive canary', 18, 'project', 'test', 1)`
    ).run(now, now);
    const row = db.prepare("SELECT rowid FROM prompts WHERE id = 'tui-1'").get();
    db.prepare(
      "INSERT INTO prompts_fts (rowid, prompt_text, response_text) VALUES (?, 'interactive canary', '')"
    ).run(row.rowid);

    expect(getPromptCount(db)).toBe(1);
    expect(loadPrompts(db)).toMatchObject([{ id: "tui-1", favorited: 0 }]);
    expect(searchPrompts(db, "canary")).toHaveLength(1);
    expect(toggleFavorite(db, "tui-1")).toBe(true);
    expect(loadPrompts(db)).toMatchObject([{ id: "tui-1", favorited: 1 }]);

    expect(deletePrompt(db, "tui-1")).toBe(true);
    expect(getPromptCount(db)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM prompts_fts").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM favorite_prompts").get().count).toBe(0);
    db.close();
  });
});

describe("TUI clipboard integration", () => {
  it("uses an available Linux clipboard command without assuming pbcopy", () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = vi.fn();
    const spawn = vi.fn(() => child);
    const spawnSync = vi.fn((_command, [candidate]) => ({
      status: candidate === "xclip" ? 0 : 1,
    }));

    expect(
      copyToClipboard("copied", { platform: "linux", spawn, spawnSync })
    ).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "xclip",
      ["-selection", "clipboard"],
      { stdio: ["pipe", "ignore", "ignore"] }
    );
    expect(child.stdin.end).toHaveBeenCalledWith("copied");
  });

  it("returns false when no supported clipboard command is installed", () => {
    expect(
      copyToClipboard("copied", {
        platform: "linux",
        spawn: vi.fn(),
        spawnSync: vi.fn(() => ({ status: 1 })),
      })
    ).toBe(false);
  });
});

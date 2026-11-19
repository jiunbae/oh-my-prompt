const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveSetupMode } = require("../setup");

const CLI = path.join(__dirname, "..", "cli.js");

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "omp-setup-local-"));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  return home;
}

function runOmp(home, args, extraEnv = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    // Non-interactive and isolated from the developer's real config.
    CI: "1",
    NO_COLOR: "1",
    ...extraEnv,
  };
  return spawnSync(process.execPath, [CLI, ...args], {
    env,
    cwd: home,
    encoding: "utf8",
    timeout: 60000,
  });
}

function readConfig(home) {
  return JSON.parse(
    fs.readFileSync(path.join(home, ".config", "oh-my-prompt", "config.json"), "utf8")
  );
}

describe("resolveSetupMode", () => {
  it("returns local for --local and --mode local", () => {
    expect(resolveSetupMode({ local: true })).toEqual({ mode: "local", error: null });
    expect(resolveSetupMode({ mode: "local" })).toEqual({ mode: "local", error: null });
  });

  it("returns server when a server, token or --mode server is given", () => {
    expect(resolveSetupMode({ server: "https://x.example" }).mode).toBe("server");
    expect(resolveSetupMode({ token: "t" }).mode).toBe("server");
    expect(resolveSetupMode({ mode: "server" }).mode).toBe("server");
  });

  it("asks (null) when nothing is specified", () => {
    expect(resolveSetupMode({})).toEqual({ mode: null, error: null });
  });

  it("rejects contradictory or unknown modes", () => {
    expect(resolveSetupMode({ local: true, token: "t" }).error).toMatch(/cannot be combined/);
    expect(resolveSetupMode({ local: true, mode: "server" }).error).toMatch(/cannot be combined/);
    expect(resolveSetupMode({ mode: "cloud" }).error).toMatch(/Unknown --mode/);
  });
});

describe("omp setup --local (fresh HOME, no server)", () => {
  let home;
  beforeEach(() => {
    home = makeHome();
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("configures local-only capture without server URL or token", () => {
    const res = runOmp(home, ["setup", "--local", "--yes", "--hooks", "claude"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("local only");

    const config = readConfig(home);
    expect(config.server.url).toBe("");
    expect(config.server.token).toBe("");
    expect(config.hooks.enabled.claude_code).toBe(true);
    expect(fs.existsSync(config.storage.sqlite.path)).toBe(true);
    expect(fs.existsSync(path.join(home, ".claude", "hooks", "prompt-logger.sh"))).toBe(true);

    const doctor = runOmp(home, ["doctor", "--json"]);
    expect(doctor.status).toBe(0);
    const report = JSON.parse(doctor.stdout);
    expect(report.errors).toEqual([]);
  });

  it("records an ingested prompt locally with no server configured", () => {
    expect(runOmp(home, ["setup", "--local", "--yes", "--no-hooks"]).status).toBe(0);

    const payload = JSON.stringify({
      session_id: "local-session",
      cwd: home,
      hook_event_name: "UserPromptSubmit",
      text: "local-only capture works",
      source: "claude-code",
      cli_name: "claude",
    });
    const ingest = spawnSync(process.execPath, [CLI, "ingest", "--stdin"], {
      env: { PATH: process.env.PATH, HOME: home, CI: "1", NO_COLOR: "1" },
      input: payload,
      encoding: "utf8",
      timeout: 60000,
    });
    expect(ingest.status).toBe(0);

    const search = runOmp(home, ["search", "local-only", "--json"]);
    expect(search.status).toBe(0);
    expect(search.stdout).toContain("local-only capture works");
  });

  it("keeps the legacy non-interactive error without --local, and suggests --local", () => {
    const res = runOmp(home, ["setup", "--yes", "--no-hooks"]);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("--local");
  });

  it("rejects --local combined with --token", () => {
    const res = runOmp(home, ["setup", "--local", "--token", "abc", "--yes"]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("cannot be combined");
  });

  it("does not touch existing server settings when re-run with --local", () => {
    const configDir = path.join(home, ".config", "oh-my-prompt");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ server: { url: "https://omp.example", token: "keep-me", deviceId: "dev" } })
    );

    const res = runOmp(home, ["setup", "--local", "--yes", "--no-hooks"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("left unchanged");

    const config = readConfig(home);
    expect(config.server.url).toBe("https://omp.example");
    expect(config.server.token).toBe("keep-me");
  });
});

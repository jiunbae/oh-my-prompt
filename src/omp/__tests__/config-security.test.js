const { defaultConfig, getConfigSummary, isSensitiveConfigPath, redactConfig } = require("../config");
const { validateConfig } = require("../doctor");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

describe("configuration secret handling", () => {
  it("redacts nested secret values without mutating the original config", () => {
    const config = defaultConfig();
    config.server.token = "server-secret";
    config.sync.userToken = "legacy-secret";

    const redacted = redactConfig(config);

    expect(redacted.server.token).toBe("[REDACTED]");
    expect(redacted.sync.userToken).toBe("[REDACTED]");
    expect(config.server.token).toBe("server-secret");
    expect(isSensitiveConfigPath("server.token")).toBe(true);
    expect(isSensitiveConfigPath("server.url")).toBe(false);
  });

  it("reports only token presence in status summaries", () => {
    const config = defaultConfig();
    config.server.token = "abcdefgh-super-secret";
    expect(getConfigSummary(config).serverToken).toBe("(configured)");
    expect(JSON.stringify(getConfigSummary(config))).not.toContain("abcdefgh");
  });

  it("warns for non-loopback HTTP but permits loopback development URLs", () => {
    const remote = defaultConfig();
    remote.server = { url: "http://example.com:4080", token: "secret", deviceId: "device" };
    expect(validateConfig(remote).warnings).toContain(
      "server.url uses unencrypted HTTP for a non-loopback host; use HTTPS or a secure tunnel"
    );

    const local = defaultConfig();
    local.server = { url: "http://127.0.0.1:4080", token: "secret", deviceId: "device" };
    expect(validateConfig(local).warnings).not.toContain(
      "server.url uses unencrypted HTTP for a non-loopback host; use HTTPS or a secure tunnel"
    );
  });

  it("redacts config CLI output unless secrets are explicitly requested", () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "omp-config-security-"));
    const configDir = path.join(xdg, "oh-my-prompt");
    fs.mkdirSync(configDir, { recursive: true });
    const config = defaultConfig();
    config.server.token = "cli-secret-canary";
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(config));
    const cliPath = path.join(__dirname, "..", "cli.js");
    const run = (args, input) => execFileSync(process.execPath, [cliPath, ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, XDG_CONFIG_HOME: xdg },
    });

    const redacted = run(["config", "get"]);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("cli-secret-canary");
    expect(run(["config", "get", "server.token"]).trim()).toBe("[REDACTED]");
    expect(run(["config", "get", "server.token", "--show-secrets"]).trim()).toBe(
      "cli-secret-canary"
    );

    const setResult = run([
      "config", "set", "server.token", "new-cli-secret", "--json",
    ]);
    expect(setResult).toContain("[REDACTED]");
    expect(setResult).not.toContain("new-cli-secret");

    const stdinResult = run(
      ["config", "set", "server.token", "--stdin", "--json"],
      "true \n"
    );
    expect(stdinResult).toContain("[REDACTED]");
    expect(stdinResult).not.toContain("true ");
    expect(JSON.parse(fs.readFileSync(path.join(configDir, "config.json"), "utf8")).server.token)
      .toBe("true ");

    const configHelp = run(["config", "--help"]);
    expect(configHelp).toContain("--stdin");
    expect(configHelp).toContain("--show-secrets");
    expect(run(["status", "--help"])).not.toContain("--show-secrets");
  });
});

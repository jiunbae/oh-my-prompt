const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SERVICE_NAME,
  renderUserService,
  installUserService,
  uninstallUserService,
  getUserServiceStatus,
} = require("../auto-sync-service");

describe("auto-sync systemd user service", () => {
  it("renders a foreground, restartable service", () => {
    const unit = renderUserService({
      nodePath: "/opt/node/bin/node",
      daemonPath: "/opt/omp/lib/auto-sync-daemon-entry.js",
      configPath: "/home/test/.config/oh-my-prompt/config.json",
    });

    expect(unit).toContain(
      'ExecStart="/opt/node/bin/node" "/opt/omp/lib/auto-sync-daemon-entry.js" "/home/test/.config/oh-my-prompt/config.json"'
    );
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("Nice=10");
    expect(unit).toContain("CPUWeight=10");
    expect(unit).toContain("IOWeight=10");
    expect(unit).toContain("IOSchedulingClass=best-effort");
    expect(unit).toContain("IOSchedulingPriority=7");
    expect(unit).toContain("WantedBy=default.target");
    expect(unit).toContain("OMP_CONFIG_PATH=/home/test/.config/oh-my-prompt/config.json");
  });

  it("resolves relative paths before writing the unit", () => {
    const unit = renderUserService({
      nodePath: "/opt/node/bin/node",
      daemonPath: "packages/omp-cli/lib/auto-sync-daemon-entry.js",
      configPath: ".tmp/config.json",
    });

    expect(unit).toContain(
      `"${path.resolve("packages/omp-cli/lib/auto-sync-daemon-entry.js")}"`
    );
    expect(unit).toContain(`OMP_CONFIG_PATH=${path.resolve(".tmp/config.json")}`);
  });

  it("installs, enables, and removes the user unit without a shell", () => {
    if (process.platform !== "linux") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-systemd-test-"));
    const servicePath = path.join(root, SERVICE_NAME);
    const calls = [];
    const execute = (command, args) => calls.push([command, args]);

    const installed = installUserService({
      servicePath,
      nodePath: "/node",
      daemonPath: "/omp-daemon",
      configPath: "/config.json",
      execFileSync: execute,
    });

    expect(installed.installed).toBe(true);
    expect(fs.existsSync(servicePath)).toBe(true);
    expect(calls).toContainEqual([
      "systemctl",
      ["--user", "enable", SERVICE_NAME],
    ]);

    const status = getUserServiceStatus({
      servicePath,
      spawnSync: (_command, args) => ({
        status: args.includes("is-enabled") || args.includes("is-active") ? 0 : 1,
      }),
    });
    expect(status).toMatchObject({ installed: true, enabled: true, active: true });

    const removed = uninstallUserService({ servicePath, execFileSync: execute });
    expect(removed.uninstalled).toBe(true);
    expect(fs.existsSync(servicePath)).toBe(false);
  });

  it("enables the unit for next login when the user manager is offline", () => {
    if (process.platform !== "linux") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-systemd-offline-test-"));
    const servicePath = path.join(root, SERVICE_NAME);
    const calls = [];
    const execute = (command, args) => {
      calls.push([command, args]);
      if (args.includes("show-environment")) throw new Error("user bus offline");
    };

    const installed = installUserService({
      servicePath,
      nodePath: "/node",
      daemonPath: "/omp-daemon",
      configPath: "/config.json",
      execFileSync: execute,
    });

    expect(installed).toMatchObject({
      installed: true,
      enabled: true,
      active: false,
    });
    expect(installed.warning).toContain("next login");
    expect(calls).not.toContainEqual([
      "systemctl",
      ["--user", "start", SERVICE_NAME],
    ]);
  });
});

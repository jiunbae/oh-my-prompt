const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { getConfigDir, getConfigPath, ensureDir } = require("./paths");

const SERVICE_NAME = "oh-my-prompt-sync.service";

function getUserServicePath() {
  return path.join(path.dirname(getConfigDir()), "systemd", "user", SERVICE_NAME);
}

function quoteSystemd(value) {
  const raw = String(value);
  if (/[\0\r\n]/.test(raw)) {
    throw new Error("systemd service paths cannot contain control characters");
  }
  return `"${raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "$$")
    .replace(/%/g, "%%")}"`;
}

function renderUserService(options = {}) {
  const nodePath = options.nodePath || process.execPath;
  const rawCliPath = options.cliPath || process.argv[1];
  const rawConfigPath = options.configPath || getConfigPath();
  if (!rawCliPath) throw new Error("Could not determine the omp CLI entry path");
  // systemd does not inherit the caller's working directory. Resolve every
  // path at install time so `node ./bin/omp` cannot create a unit that only
  // happens to work from the repository directory.
  const cliPath = path.resolve(rawCliPath);
  const configPath = path.resolve(rawConfigPath);

  return `[Unit]
Description=Oh My Prompt event-driven sync
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=${quoteSystemd(`OMP_CONFIG_PATH=${configPath}`)}
ExecStart=${quoteSystemd(nodePath)} ${quoteSystemd(cliPath)} sync auto run
Restart=on-failure
RestartSec=10
TimeoutStopSec=20
KillSignal=SIGTERM
UMask=0077

[Install]
WantedBy=default.target
`;
}

function assertSystemdAvailable(execute = execFileSync) {
  if (process.platform !== "linux") {
    const error = new Error("systemd user services are supported on Linux only");
    error.code = "OMP_SYSTEMD_UNAVAILABLE";
    throw error;
  }
  try {
    execute("systemctl", ["--user", "--version"], { stdio: "ignore" });
  } catch {
    const error = new Error(
      "systemd user services are unavailable. Ensure `systemctl --user` works for this login."
    );
    error.code = "OMP_SYSTEMD_UNAVAILABLE";
    throw error;
  }
}

function isUserManagerAvailable(execute = execFileSync) {
  try {
    execute("systemctl", ["--user", "show-environment"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function installUserService(options = {}) {
  const execute = options.execFileSync || execFileSync;
  assertSystemdAvailable(execute);
  const servicePath = options.servicePath || getUserServicePath();
  ensureDir(path.dirname(servicePath));
  fs.writeFileSync(servicePath, renderUserService(options), { mode: 0o600 });
  // Enabling only edits the user's unit symlinks and works even when this shell
  // has no user D-Bus session (common in containers and remote automation).
  execute("systemctl", ["--user", "enable", SERVICE_NAME], { stdio: "ignore" });

  const managerAvailable = isUserManagerAvailable(execute);
  if (managerAvailable) {
    execute("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    execute("systemctl", ["--user", "start", SERVICE_NAME], { stdio: "ignore" });
  }
  return {
    installed: true,
    enabled: true,
    active: managerAvailable,
    servicePath,
    serviceName: SERVICE_NAME,
    ...(!managerAvailable
      ? { warning: "systemd user manager is offline; service is enabled for the next login" }
      : {}),
  };
}

function uninstallUserService(options = {}) {
  const execute = options.execFileSync || execFileSync;
  const servicePath = options.servicePath || getUserServicePath();
  if (!fs.existsSync(servicePath)) {
    return { uninstalled: false, wasInstalled: false, servicePath, serviceName: SERVICE_NAME };
  }
  assertSystemdAvailable(execute);
  const managerAvailable = isUserManagerAvailable(execute);
  try {
    if (managerAvailable) {
      execute("systemctl", ["--user", "stop", SERVICE_NAME], { stdio: "ignore" });
    }
    execute("systemctl", ["--user", "disable", SERVICE_NAME], { stdio: "ignore" });
  } finally {
    fs.unlinkSync(servicePath);
    if (managerAvailable) {
      execute("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    }
  }
  return { uninstalled: true, wasInstalled: true, servicePath, serviceName: SERVICE_NAME };
}

function startUserService(options = {}) {
  const execute = options.execFileSync || execFileSync;
  assertSystemdAvailable(execute);
  execute("systemctl", ["--user", "enable", SERVICE_NAME], { stdio: "ignore" });
  if (!isUserManagerAvailable(execute)) {
    return {
      started: false,
      managed: true,
      serviceName: SERVICE_NAME,
      warning: "systemd user manager is offline; service is enabled for the next login",
    };
  }
  execute("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  execute("systemctl", ["--user", "start", SERVICE_NAME], { stdio: "ignore" });
  return { started: true, managed: true, serviceName: SERVICE_NAME };
}

function stopUserService(options = {}) {
  const execute = options.execFileSync || execFileSync;
  assertSystemdAvailable(execute);
  if (isUserManagerAvailable(execute)) {
    execute("systemctl", ["--user", "stop", SERVICE_NAME], { stdio: "ignore" });
  }
  execute("systemctl", ["--user", "disable", SERVICE_NAME], { stdio: "ignore" });
  return { stopped: true, managed: true, serviceName: SERVICE_NAME };
}

function getUserServiceStatus(options = {}) {
  const servicePath = options.servicePath || getUserServicePath();
  const installed = fs.existsSync(servicePath);
  if (!installed || process.platform !== "linux") {
    return {
      installed,
      enabled: false,
      active: false,
      servicePath,
      serviceName: SERVICE_NAME,
    };
  }

  const run = options.spawnSync || spawnSync;
  const enabled = run("systemctl", ["--user", "is-enabled", "--quiet", SERVICE_NAME], {
    stdio: "ignore",
  }).status === 0;
  const active = run("systemctl", ["--user", "is-active", "--quiet", SERVICE_NAME], {
    stdio: "ignore",
  }).status === 0;
  return { installed, enabled, active, servicePath, serviceName: SERVICE_NAME };
}

module.exports = {
  SERVICE_NAME,
  getUserServicePath,
  renderUserService,
  assertSystemdAvailable,
  installUserService,
  uninstallUserService,
  startUserService,
  stopUserService,
  getUserServiceStatus,
};

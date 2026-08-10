const os = require("os");
const { spawnSync } = require("child_process");

const BACKGROUND_NICE = 10;

/**
 * Lower CPU and disk scheduling priority for background OMP work. Failures are
 * intentionally non-fatal: unsupported platforms should keep working with the
 * OS defaults, while Linux uses the lowest best-effort I/O priority whenever
 * `ionice` is available. Idle-class I/O can starve a DB lock holder forever on
 * a busy workstation, which then blocks every later capture.
 */
function lowerBackgroundPriority(options = {}) {
  const result = { cpu: false, io: false };
  const setPriority = options.setPriority || os.setPriority;
  const execute = options.spawnSync || spawnSync;
  const platform = options.platform || process.platform;
  const pid = options.pid || process.pid;
  try {
    setPriority(pid, options.nice ?? BACKGROUND_NICE);
    result.cpu = true;
  } catch {
    // Priority changes can be restricted by the host/container policy.
  }

  if (platform === "linux" && options.io !== false) {
    try {
      const ioResult = execute(
        "ionice",
        ["-c", "2", "-n", "7", "-p", String(pid)],
        { stdio: "ignore", timeout: 1000 }
      );
      result.io = ioResult.status === 0;
    } catch {
      // ionice is optional and not present on every Linux distribution.
    }
  }

  return result;
}

module.exports = { BACKGROUND_NICE, lowerBackgroundPriority };

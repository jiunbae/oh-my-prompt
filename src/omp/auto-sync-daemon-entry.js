const { daemonStatus, stopDaemon, runDaemonLoop } = require("./auto-sync");

// When a systemd user manager comes online after the detached fallback was
// started, transfer ownership to the managed service instead of leaving two
// event watchers alive. A stale pidfile is cleaned by daemonStatus().
const existing = daemonStatus();
if (existing.running && existing.pid !== process.pid) stopDaemon();
runDaemonLoop(process.argv[2]);

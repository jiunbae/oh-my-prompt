// Worker entry: parse one transcript file at a time and post results back.
// Kept minimal and dependency-free (no DB) so workers spin up cheaply.

const fs = require("fs");
const { parentPort } = require("worker_threads");
const { parseTranscript } = require("./transcript-parser");

if (!parentPort) {
  throw new Error("backfill-worker.js must be run as a worker_thread");
}

parentPort.on("message", (msg) => {
  if (msg === "shutdown") {
    parentPort.close();
    return;
  }
  const { filePath } = msg;
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    const turns = parseTranscript(lines);
    parentPort.postMessage({ ok: true, turns });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message || "parse failed" });
  }
});

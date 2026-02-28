/**
 * ui.js — CJS-compatible UI abstraction layer
 *
 * Wraps @clack/prompts (ESM, lazy-loaded via dynamic import) and
 * picocolors (CJS, always available) into a single clean API.
 *
 * Usage:
 *   const { c, loadClack } = require("./ui");
 *   console.log(c.green("hello"));          // synchronous colors
 *   const clack = await loadClack();        // async prompts
 *   const name = await clack.text({ ... });
 */

const pc = require("picocolors");

// ---------------------------------------------------------------------------
// Colors — re-export picocolors as `c` for brevity
// ---------------------------------------------------------------------------

const c = pc;

// ---------------------------------------------------------------------------
// @clack/prompts — lazy-loaded singleton (ESM-only package)
// ---------------------------------------------------------------------------

let _clack = null;

async function loadClack() {
  if (!_clack) {
    _clack = await import("@clack/prompts");
  }
  return _clack;
}

// ---------------------------------------------------------------------------
// High-level helpers that combine clack + picocolors
// ---------------------------------------------------------------------------

/**
 * Check if a clack prompt return value was cancelled (Ctrl-C).
 * If so, call clack.cancel() and exit with code 130.
 */
function handleCancel(value, message = "Setup cancelled.") {
  if (_clack && _clack.isCancel(value)) {
    _clack.cancel(message);
    process.exit(130);
  }
}

/**
 * Returns true when we should use interactive clack prompts.
 * False in non-TTY, CI, or when --yes is passed.
 */
function isInteractive(options) {
  if (options.yes || options.y) return false;
  if (!process.stdin.isTTY) return false;
  if (process.env.CI) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Formatted output helpers (non-interactive, using picocolors only)
// ---------------------------------------------------------------------------

function label(key, value) {
  return `${c.dim(key + ":")} ${value}`;
}

function pass(msg) {
  return `${c.green("✔")} ${msg}`;
}

function fail(msg) {
  return `${c.red("✖")} ${msg}`;
}

function warn(msg) {
  return `${c.yellow("▲")} ${msg}`;
}

function info(msg) {
  return `${c.blue("●")} ${msg}`;
}

module.exports = {
  c,
  loadClack,
  handleCancel,
  isInteractive,
  label,
  pass,
  fail,
  warn,
  info,
};

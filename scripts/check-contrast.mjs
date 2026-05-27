#!/usr/bin/env node
/**
 * check-contrast.mjs
 *
 * Parses src/app/globals.css and verifies WCAG contrast ratios for every theme.
 * - Normal text (foreground / muted-foreground / etc. on background or card): AA 4.5:1
 * - UI components (border on background): WCAG SC 1.4.11 — 3:1
 *
 * Exits non-zero when any required pair fails its threshold.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CSS_PATH = resolve(__dirname, "../src/app/globals.css");

// ---------- color math ----------

function parseHex(hex) {
  const m = hex.trim().replace(/^#/, "");
  let r, g, b;
  if (m.length === 3) {
    r = parseInt(m[0] + m[0], 16);
    g = parseInt(m[1] + m[1], 16);
    b = parseInt(m[2] + m[2], 16);
  } else if (m.length === 6) {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  } else {
    throw new Error(`Unrecognised hex color: ${hex}`);
  }
  return { r, g, b };
}

function srgbToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(parseHex(hex1));
  const l2 = relativeLuminance(parseHex(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------- css parsing ----------

const CSS = readFileSync(CSS_PATH, "utf8");

/**
 * Extract a theme block. We match the *first* occurrence of the selector { ... }.
 * We don't try to parse the whole CSS — this is a targeted lookup.
 */
function extractBlock(selector) {
  // Escape selector for use in regex
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match `selector ... { ... }` where the body has no `{` inside (top-level only).
  const re = new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "m");
  const match = CSS.match(re);
  if (!match) throw new Error(`Could not find selector block: ${selector}`);
  return match[1];
}

function parseTokens(block) {
  const tokens = {};
  // Match lines like:  --name: #abcdef;   or  --name: rgba(...);
  // We only care about hex values for contrast checking. rgba()/var() are ignored.
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    const name = m[1].trim();
    const value = m[2].trim();
    tokens[name] = value;
  }
  return tokens;
}

function isHex(v) {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

// ---------- themes ----------

const THEMES = [
  { name: "light (:root)", selector: ":root" },
  { name: "dark (.dark)", selector: ".dark" },
  { name: "midnight-ocean", selector: ".midnight-ocean" },
  { name: "forest-dusk", selector: ".forest-dusk" },
  { name: "sunset-glow", selector: ".sunset-glow" },
  { name: "lavender-mist", selector: ".lavender-mist" },
];

// Pairs to verify per theme.
// shape: { fg, bg, threshold, label, kind }
// kind: "text" (AA 4.5) or "ui" (SC 1.4.11 3:1)
const PAIRS = [
  { fg: "foreground", bg: "background", threshold: 4.5, kind: "text" },
  { fg: "foreground", bg: "card", threshold: 4.5, kind: "text" },
  { fg: "muted-foreground", bg: "background", threshold: 4.5, kind: "text" },
  { fg: "muted-foreground", bg: "card", threshold: 4.5, kind: "text" },
  { fg: "secondary-foreground", bg: "background", threshold: 4.5, kind: "text" },
  { fg: "secondary-foreground", bg: "secondary", threshold: 4.5, kind: "text" },
  { fg: "card-foreground", bg: "card", threshold: 4.5, kind: "text" },
  { fg: "accent-foreground", bg: "accent", threshold: 4.5, kind: "text" },
  { fg: "primary-foreground", bg: "primary", threshold: 4.5, kind: "text" },
  { fg: "destructive-foreground", bg: "destructive", threshold: 4.5, kind: "text" },
  { fg: "border", bg: "background", threshold: 3.0, kind: "ui" },
  { fg: "border", bg: "card", threshold: 3.0, kind: "ui" },
];

const CHART_TOKENS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

// ---------- main ----------

function color(s, code) {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const green = (s) => color(s, 32);
const red = (s) => color(s, 31);
const yellow = (s) => color(s, 33);
const dim = (s) => color(s, 2);
const bold = (s) => color(s, 1);

let failures = 0;
let total = 0;

for (const theme of THEMES) {
  const block = extractBlock(theme.selector);
  const tokens = parseTokens(block);

  // For derived themes that inherit (`.dark` is sibling, custom themes override
  // selected vars), we want to verify only what is *defined* in the block. But
  // background / foreground / card etc. must be present in every theme block —
  // and they are (each theme self-defines those). For tokens missing in a
  // theme (e.g. shouldn't happen), we skip with a warning rather than fail.

  console.log("");
  console.log(bold(theme.name));

  const checks = [];

  for (const pair of PAIRS) {
    const fg = tokens[pair.fg];
    const bg = tokens[pair.bg];
    if (!fg || !bg) {
      checks.push({ label: `${pair.fg} / ${pair.bg}`, skipped: true, reason: "not-defined" });
      continue;
    }
    if (!isHex(fg) || !isHex(bg)) {
      checks.push({ label: `${pair.fg} / ${pair.bg}`, skipped: true, reason: "non-hex" });
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= pair.threshold;
    checks.push({
      label: `${pair.fg} / ${pair.bg}`,
      ratio,
      threshold: pair.threshold,
      kind: pair.kind,
      pass,
    });
  }

  // chart-N / background — for chart accent-on-canvas legibility we use 3:1
  // (non-text UI element; charts also use these as fills next to text labels).
  for (const cname of CHART_TOKENS) {
    const fg = tokens[cname];
    const bg = tokens.background;
    if (!fg || !bg) continue;
    if (!isHex(fg) || !isHex(bg)) continue;
    const ratio = contrastRatio(fg, bg);
    const threshold = 3.0;
    const pass = ratio >= threshold;
    checks.push({
      label: `${cname} / background`,
      ratio,
      threshold,
      kind: "ui",
      pass,
    });
  }

  for (const c of checks) {
    total += 1;
    if (c.skipped) {
      console.log(`  ${yellow("skip")}  ${c.label}  ${dim("(" + c.reason + ")")}`);
      continue;
    }
    const r = c.ratio.toFixed(2);
    const t = c.threshold.toFixed(1);
    const tag = c.kind === "text" ? "AA-text" : "UI-3:1";
    if (c.pass) {
      console.log(`  ${green("pass")}  ${c.label}  ${dim("ratio=" + r + " ≥ " + t + " " + tag)}`);
    } else {
      failures += 1;
      console.log(`  ${red("FAIL")}  ${c.label}  ${red("ratio=" + r + " < " + t + " " + tag)}`);
    }
  }
}

console.log("");
console.log(bold("Summary"));
console.log(`  checks: ${total}`);
console.log(`  ${failures === 0 ? green("all passing") : red(failures + " failing")}`);

process.exit(failures === 0 ? 0 : 1);

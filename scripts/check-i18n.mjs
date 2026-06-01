#!/usr/bin/env node
/**
 * check-i18n.mjs
 *
 * Validates locale message catalogs in messages/ for parity against a
 * reference locale (default: en). Catches the class of bug where a feature
 * is translated in one locale but a whole key subtree is forgotten in another
 * (e.g. the `insights` namespace landing in en.json but not ko.json).
 *
 * Checks, per non-reference locale:
 *   1. Missing keys  — present in the reference but absent here.
 *   2. Extra keys    — present here but absent in the reference.
 *   3. Placeholder mismatches — a shared key whose ICU placeholders ({n},
 *      {value}, …) differ from the reference (a common cause of runtime
 *      MISSING_VALUE / malformed-message errors).
 *
 * Arrays are compared element-by-element (index becomes part of the path), so
 * length mismatches surface as missing/extra keys too.
 *
 * Exits non-zero when any problem is found. Pure Node, no dependencies.
 *
 * Env overrides (used by tests):
 *   MESSAGES_DIR             directory of <locale>.json files
 *   I18N_REFERENCE_LOCALE    reference locale basename (default: en)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MESSAGES_DIR =
  process.env.MESSAGES_DIR || resolve(__dirname, "../messages");
const REFERENCE = process.env.I18N_REFERENCE_LOCALE || "en";

// ---------- helpers ----------

/** Flatten a nested object/array into a Map<dotPath, leafStringValue>. */
function flatten(value, prefix, out) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

/**
 * Extract the set of ICU placeholder variable names from a message string.
 * `"You made {count} prompts in {n} sessions"` -> Set { "count", "n" }.
 * Captures the leading identifier of each `{…}` group, which also covers
 * plural/select forms like `{count, plural, …}`.
 */
function placeholders(message) {
  const names = new Set();
  if (typeof message !== "string") return names;
  const re = /\{\s*([a-zA-Z0-9_]+)\s*(?:,[^}]*)?\}/g;
  let m;
  while ((m = re.exec(message)) !== null) names.add(m[1]);
  return names;
}

function loadLocale(localeFile) {
  const path = join(MESSAGES_DIR, localeFile);
  try {
    return flatten(JSON.parse(readFileSync(path, "utf8")), "", new Map());
  } catch (err) {
    console.error(`✖ Failed to read/parse ${localeFile}: ${err.message}`);
    process.exit(2);
  }
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ---------- main ----------

const localeFiles = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

const refFile = `${REFERENCE}.json`;
if (!localeFiles.includes(refFile)) {
  console.error(
    `✖ Reference locale "${refFile}" not found in ${MESSAGES_DIR}. ` +
      `Found: ${localeFiles.join(", ") || "(none)"}`,
  );
  process.exit(2);
}

const refKeys = loadLocale(refFile);
const targets = localeFiles.filter((f) => f !== refFile);

if (targets.length === 0) {
  console.log(`No non-reference locales to check (only ${refFile}). OK.`);
  process.exit(0);
}

let problems = 0;

for (const file of targets) {
  const keys = loadLocale(file);

  const missing = [];
  const placeholderMismatches = [];
  for (const [key, refVal] of refKeys) {
    if (!keys.has(key)) {
      missing.push(key);
      continue;
    }
    const refPh = placeholders(refVal);
    const tgtPh = placeholders(keys.get(key));
    if (!setsEqual(refPh, tgtPh)) {
      placeholderMismatches.push({
        key,
        ref: [...refPh].sort(),
        got: [...tgtPh].sort(),
      });
    }
  }

  const extra = [];
  for (const key of keys.keys()) {
    if (!refKeys.has(key)) extra.push(key);
  }

  const localeProblems =
    missing.length + extra.length + placeholderMismatches.length;
  if (localeProblems === 0) {
    console.log(`✓ ${file} — in sync with ${refFile} (${keys.size} keys)`);
    continue;
  }

  problems += localeProblems;
  console.error(`\n✖ ${file} — ${localeProblems} issue(s) vs ${refFile}:`);

  if (missing.length) {
    console.error(`  Missing ${missing.length} key(s) (present in ${REFERENCE}, absent here):`);
    for (const k of missing) console.error(`    - ${k}`);
  }
  if (extra.length) {
    console.error(`  Extra ${extra.length} key(s) (here but not in ${REFERENCE}):`);
    for (const k of extra) console.error(`    + ${k}`);
  }
  if (placeholderMismatches.length) {
    console.error(`  Placeholder mismatch in ${placeholderMismatches.length} key(s):`);
    for (const { key, ref, got } of placeholderMismatches) {
      console.error(`    ~ ${key}: ${REFERENCE}={${ref.join(", ")}} got={${got.join(", ")}}`);
    }
  }
}

if (problems > 0) {
  console.error(
    `\n✖ i18n check failed: ${problems} issue(s) across ${targets.length} locale(s).`,
  );
  console.error("  Fix by adding the missing keys (and matching placeholders) so every locale mirrors the reference.");
  process.exit(1);
}

console.log(`\n✓ i18n check passed: all ${targets.length} locale(s) match ${refFile}.`);

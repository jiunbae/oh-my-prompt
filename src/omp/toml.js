let tomlParser = null;
try {
  tomlParser = require("toml");
} catch (error) {
  tomlParser = null;
}

// TOML string arrays are *almost* JSON, but three legal TOML spellings are not:
// trailing commas before `]`, `#` comments inside the brackets, and single-quoted
// literal strings. Codex writes multi-line arrays with a trailing comma, so
// JSON.parse alone rejects the value the installer most needs to read. Parsing it
// here keeps the common case independent of the optional `toml` package, which is
// not a dependency of the published CLI.
// Returns null (not a throw) for anything richer — nested arrays, numbers,
// booleans — so callers fall through to the parser paths below.
function parseTomlStringArray(text) {
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  const body = text.slice(1, -1);
  const out = [];
  let i = 0;
  let expectValue = true;

  while (i < body.length) {
    const ch = body[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "#") {
      const nl = body.indexOf("\n", i);
      if (nl === -1) break;
      i = nl + 1;
      continue;
    }
    if (ch === ",") {
      if (expectValue) return null; // leading or doubled comma
      expectValue = true;
      i += 1;
      continue;
    }
    if (!expectValue) return null; // two values with no separator

    if (ch === '"') {
      let j = i + 1;
      let value = "";
      while (j < body.length) {
        const c = body[j];
        if (c === "\\") {
          const next = body[j + 1];
          if (next === undefined) return null;
          if (next === "n") value += "\n";
          else if (next === "t") value += "\t";
          else if (next === "r") value += "\r";
          else value += next; // covers \" and \\
          j += 2;
          continue;
        }
        if (c === '"') break;
        value += c;
        j += 1;
      }
      if (j >= body.length) return null; // unterminated
      out.push(value);
      expectValue = false;
      i = j + 1;
      continue;
    }

    if (ch === "'") {
      // TOML literal string: no escape processing.
      const end = body.indexOf("'", i + 1);
      if (end === -1) return null;
      out.push(body.slice(i + 1, end));
      expectValue = false;
      i = end + 1;
      continue;
    }

    return null; // not a string element
  }

  return out;
}

function parseTomlValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const stringArray = parseTomlStringArray(trimmed);
    if (stringArray) return stringArray;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      // fall through
    }
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const number = Number(trimmed);
  if (!Number.isNaN(number)) return number;

  if (tomlParser) {
    try {
      const parsed = tomlParser.parse(`value = ${trimmed}`);
      return parsed.value;
    } catch (error) {
      // ignore
    }
  }

  return trimmed;
}

function findTomlLine(content, key) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const withoutComment = line.split("#")[0];
    if (!withoutComment.trim()) continue;
    const match = withoutComment.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    if (match[1] === key) {
      let valueText = match[2].trim();
      let endIndex = i;

      if (valueText.startsWith("[") && !valueText.includes("]")) {
        let open = (valueText.match(/\[/g) || []).length;
        let close = (valueText.match(/\]/g) || []).length;
        while (open > close && endIndex + 1 < lines.length) {
          endIndex += 1;
          const nextLine = lines[endIndex];
          valueText += `\n${nextLine}`;
          open += (nextLine.match(/\[/g) || []).length;
          close += (nextLine.match(/\]/g) || []).length;
        }
      }

      return { index: i, endIndex, line, value: valueText };
    }
  }
  return null;
}

function setTomlLine(content, key, valueLine, marker) {
  const lines = content.split("\n");
  const info = findTomlLine(content, key);
  if (info) {
    const next = [...lines];
    next.splice(info.index, info.endIndex - info.index + 1, `${key} = ${valueLine}`);
    return next.join("\n");
  }
  // Key absent: a bare top-level key must appear before the first TOML table
  // header ([section] or [[array.of.tables]]). Appending at EOF would nest it
  // under the last table, so it would no longer be a top-level key. Insert it
  // just before the first header; fall back to EOF only when there is none.
  const markerLine = marker ? `${marker}\n` : "";
  const entry = `${markerLine}${key} = ${valueLine}`;
  const headerIndex = lines.findIndex((line) => /^\s*\[/.test(line.split("#")[0]));
  if (headerIndex === -1) {
    const trimmed = content.trimEnd();
    return trimmed ? `${trimmed}\n\n${entry}\n` : `${entry}\n`;
  }
  const next = [...lines];
  next.splice(headerIndex, 0, entry, "");
  return next.join("\n");
}

function removeTomlLine(content, key) {
  const lines = content.split("\n");
  const info = findTomlLine(content, key);
  if (!info) return content;
  const next = [...lines];
  next.splice(info.index, info.endIndex - info.index + 1);
  return next.join("\n");
}

module.exports = {
  // Exported so tests can pin the dependency-free path directly, rather than
  // passing only because the optional `toml` package happens to resolve.
  parseTomlStringArray,
  parseTomlValue,
  findTomlLine,
  setTomlLine,
  removeTomlLine,
};

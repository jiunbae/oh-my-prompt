let tomlParser = null;
try {
  tomlParser = require("toml");
} catch (error) {
  tomlParser = null;
}

function parseTomlValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
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
  parseTomlValue,
  findTomlLine,
  setTomlLine,
  removeTomlLine,
};

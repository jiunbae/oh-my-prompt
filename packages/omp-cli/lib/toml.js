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
  const trimmed = content.trimEnd();
  const markerLine = marker ? `${marker}\n` : "";
  return trimmed
    ? `${trimmed}\n\n${markerLine}${key} = ${valueLine}\n`
    : `${key} = ${valueLine}\n`;
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

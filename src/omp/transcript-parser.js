// Pure-JS Claude Code transcript parsing. Kept dependency-free so it can run
// inside worker_threads without pulling in the DB stack.

const SYSTEM_PREFIXES = [
  "<local-command-caveat>",
  "<local-command-",
  "<command-name>",
  "<task-notification>",
  "<system-reminder>",
  "This session is being continued",
  "Stop hook feedback:",
];

function stripSystemTags(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim();
}

function isRealUserMessage(entry) {
  if ((entry.type || entry.role) !== "user") return false;
  const content = entry.message?.content || entry.content;
  if (typeof content !== "string") return false;
  const stripped = stripSystemTags(content.trim());
  if (!stripped) return false;

  for (const prefix of SYSTEM_PREFIXES) {
    if (stripped.startsWith(prefix)) return false;
  }
  if (stripped === "[Request interrupted by user]") return false;
  if (/^\s*(Claude Code|[▐▛])/.test(stripped)) return false;

  return true;
}

function extractText(content) {
  let text;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } else {
    return "";
  }
  return stripSystemTags(text);
}

function parseTranscript(lines) {
  const entries = [];
  for (const raw of lines) {
    try {
      entries.push(JSON.parse(raw));
    } catch {}
  }

  const turns = [];
  let current = null;

  for (const entry of entries) {
    if (isRealUserMessage(entry)) {
      const content = entry.message?.content || entry.content;
      const text = extractText(content);
      current = {
        userText: text,
        responseParts: [],
        cwd: entry.cwd || "",
        timestamp: entry.timestamp || null,
      };
      turns.push(current);
    } else if ((entry.type || entry.role) === "assistant" && current) {
      const content = entry.message?.content || entry.content;
      if (!content) continue;
      const text = extractText(content);
      if (text.trim()) {
        current.responseParts.push(text);
        if (entry.cwd) current.cwd = entry.cwd;
      }
    }
  }

  return turns.map((turn) => ({
    userText: turn.userText,
    responseText: turn.responseParts.length > 0 ? turn.responseParts.join("\n\n") : null,
    cwd: turn.cwd,
    timestamp: turn.timestamp,
  }));
}

module.exports = {
  SYSTEM_PREFIXES,
  stripSystemTags,
  isRealUserMessage,
  extractText,
  parseTranscript,
};

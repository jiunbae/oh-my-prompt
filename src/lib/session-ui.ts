export const MESSAGE_COLLAPSE_CHAR_LIMIT = 1200;
export const MESSAGE_COLLAPSE_LINE_LIMIT = 18;
export const SESSION_NAME_MAX_LENGTH = 120;

export type SessionMessageRole = "prompt" | "response";

interface MessagePrompt {
  id: string;
  responseText?: string | null;
}

export function shouldCollapseMessage(content: string): boolean {
  if (content.length > MESSAGE_COLLAPSE_CHAR_LIMIT) return true;
  return content.split(/\r\n|\r|\n/).length > MESSAGE_COLLAPSE_LINE_LIMIT;
}

export function sessionMessageId(promptId: string, role: SessionMessageRole): string {
  return `${role}:${promptId}`;
}

export function sessionMessageDomId(promptId: string, role: SessionMessageRole): string {
  return `${role}-${promptId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function getAllSessionMessageIds(prompts: MessagePrompt[]): string[] {
  return prompts.flatMap((prompt) => {
    const ids = [sessionMessageId(prompt.id, "prompt")];
    if (prompt.responseText) {
      ids.push(sessionMessageId(prompt.id, "response"));
    }
    return ids;
  });
}

export function parseStoredExpandedMessageIds(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    return new Set();
  }
}

export function serializeExpandedMessageIds(ids: Set<string>): string {
  return JSON.stringify(Array.from(ids).sort());
}

export function normalizeSessionTitleSuggestion(title: string, fallback = ""): string {
  const normalized = title
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const value = normalized || fallback.trim();
  if (value.length <= SESSION_NAME_MAX_LENGTH) return value;
  return `${value.slice(0, SESSION_NAME_MAX_LENGTH - 3).trimEnd()}...`;
}

const PROMPT_BODY_FIELDS = new Set([
  "promptText",
  "responseText",
  "prompt_text",
  "response_text",
]);

/**
 * Outgoing integrations receive prompt metadata by default, never captured
 * prompt/response bodies. The recursion covers nested metadata added by future
 * event producers as well as the current flat payloads.
 */
export function sanitizeIntegrationPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const sanitize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sanitize);
    if (!input || typeof input !== "object") return input;

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(input)) {
      if (!PROMPT_BODY_FIELDS.has(key)) result[key] = sanitize(nestedValue);
    }
    return result;
  };

  return sanitize(value) as Record<string, unknown>;
}

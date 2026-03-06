export const VALID_EVENTS = [
  "prompt.created",
  "prompt.enriched",
  "prompt.scored",
  "session.completed",
  "sync.completed",
] as const;

export type WebhookEvent = (typeof VALID_EVENTS)[number];

export const VALID_INTEGRATION_EVENTS = [
  "prompt.created",
  "prompt.favorited",
  "prompt.deleted",
  "prompt.updated",
  "session.started",
] as const;

export type IntegrationEvent = (typeof VALID_INTEGRATION_EVENTS)[number];

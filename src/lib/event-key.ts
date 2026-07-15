/**
 * Build the stable idempotency key used for uploaded prompt events.
 *
 * The user id is deliberately used as the namespace instead of the API token.
 * API tokens are credentials and must never be persisted in prompt rows, while
 * user ids remain stable when a token is rotated.
 */
export function buildEventKey(
  userId: string,
  createdAt: Date,
  eventId: string,
): string {
  const yyyy = createdAt.getUTCFullYear();
  const mm = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(createdAt.getUTCDate()).padStart(2, "0");
  const safeId = eventId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${userId}/${yyyy}/${mm}/${dd}/${safeId}.json`;
}

import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME, type SessionPayload } from "@/lib/auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export { type SessionPayload };

/**
 * Check whether a session was issued before the user's last password change.
 * If so, the session is stale and should be rejected.
 */
async function isSessionInvalidatedByPasswordChange(
  session: SessionPayload,
): Promise<boolean> {
  const [row] = await db
    .select({ passwordChangedAt: schema.users.passwordChangedAt })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (!row) return true; // User not found — treat as invalid

  // If passwordChangedAt is null the user never changed their password
  if (!row.passwordChangedAt) return false;

  // Session was issued before the password change — reject it
  return row.passwordChangedAt.getTime() > session.iat;
}

/**
 * Extract and verify the current user's session from cookies.
 * Throws AuthError if not authenticated or token is invalid.
 */
export async function requireAuth(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) {
    throw new AuthError("Not authenticated", 401);
  }
  const session = parseSessionToken(sessionToken);
  if (!session) {
    throw new AuthError("Invalid session", 401);
  }

  // Reject sessions issued before the last password change
  if (await isSessionInvalidatedByPasswordChange(session)) {
    throw new AuthError("Session invalidated by password change", 401);
  }

  return session;
}

/**
 * Verify the current user is an admin by checking the DB directly.
 * This avoids stale isAdmin claims in the session token.
 * Throws AuthError if not authenticated or not an admin.
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireAuth();
  const [row] = await db
    .select({ isAdmin: schema.users.isAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!row || !row.isAdmin) {
    throw new AuthError("Admin access required", 403);
  }
  return session;
}

/**
 * Check if the current session user is actually an admin via DB lookup.
 * Returns false (not throws) if not admin — for routes that expand access for admins.
 */
export async function checkIsAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isAdmin: schema.users.isAdmin })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.isAdmin ?? false;
}

/**
 * Get the current user from the session cookie without throwing.
 * For use in server components that redirect on null instead of throwing.
 */
export async function getSessionUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  const session = parseSessionToken(sessionToken);
  if (!session) return null;

  // Reject sessions issued before the last password change
  if (await isSessionInvalidatedByPasswordChange(session)) return null;

  return session;
}

export class AuthError extends Error {
  status: 401 | 403;

  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

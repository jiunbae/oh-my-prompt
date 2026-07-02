import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { cookies } from "next/headers";
import {
  verifyPassword,
  findUserByEmail,
  updateLastLogin,
  createSessionToken,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_OPTIONS,
} from "@/lib/auth";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";

// Fixed dummy bcrypt hash used to equalize timing when a user is not found,
// closing the login timing oracle (found vs. not-found paths take similar time).
// bcrypt hash of an arbitrary string at cost 12.
const DUMMY_PASSWORD_HASH =
  "$2a$12$5A8Ku3ljuaO5JFJzdF7Hs.foJD.71J4lVkrYjTdQSw5WZJaXmVNge";

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP (auth endpoints are unauthenticated)
    const ip = getClientIp(request);
    const rateCheck = await rateLimiters.auth(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await findUserByEmail(email);
    if (!user) {
      // Perform a dummy bcrypt comparison so the not-found path takes roughly
      // the same time as the found path, closing the user-enumeration timing
      // oracle.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Create session token
    const sessionToken = createSessionToken({
      userId: user.id,
      email: user.email,
      token: user.token,
      isAdmin: user.isAdmin ?? false,
    });

    // Set auth cookie
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, sessionToken, AUTH_COOKIE_OPTIONS);

    // Update last login
    await updateLastLogin(user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Login error");
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}

import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { SESSION_SECRET } = vi.hoisted(() => ({
  SESSION_SECRET: "test-session-secret-with-sufficient-length",
}));

vi.mock("@/env", () => ({ env: { SESSION_SECRET } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { createSessionToken, parseSessionToken } from "./auth";

describe("session credential hygiene", () => {
  it("creates a versioned session without embedding the API token", () => {
    const token = createSessionToken({
      userId: "user-1",
      email: "user@example.com",
      isAdmin: false,
    });
    const payload = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
    );

    expect(payload).toMatchObject({ v: 2, userId: "user-1" });
    expect(payload).not.toHaveProperty("token");
    expect(parseSessionToken(token)).toMatchObject({ userId: "user-1" });
  });

  it("rejects legacy cookies that embedded an API credential", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        userId: "user-1",
        email: "user@example.com",
        token: "legacy-api-token",
        isAdmin: false,
        iat: Date.now(),
      }),
    ).toString("base64url");
    const signature = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(encoded)
      .digest("base64url");

    expect(parseSessionToken(`${encoded}.${signature}`)).toBeNull();
  });
});

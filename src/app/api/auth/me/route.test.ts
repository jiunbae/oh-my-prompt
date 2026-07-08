import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserByToken: vi.fn(),
  findUserById: vi.fn(),
  requireAuth: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/services/sync", () => ({
  findUserByToken: mocks.findUserByToken,
}));

vi.mock("@/lib/auth", () => ({
  findUserById: mocks.findUserById,
}));

vi.mock("@/lib/with-auth", () => ({
  AuthError: class AuthError extends Error {},
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError },
}));

import { GET } from "./route";

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a valid sync user token", async () => {
    mocks.findUserByToken.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      token: "api-token",
      isAdmin: null,
    });

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { "X-User-Token": "api-token" },
      }) as never,
    );

    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        token: "api-token",
        isAdmin: false,
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });

  it("rejects an invalid sync user token", async () => {
    mocks.findUserByToken.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/auth/me", {
        headers: { "X-User-Token": "bad-token" },
      }) as never,
    );

    await expect(response.json()).resolves.toEqual({
      error: "Invalid user token",
    });
    expect(response.status).toBe(401);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });

  it("keeps the cookie session fallback", async () => {
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
    mocks.findUserById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: null,
      token: "api-token",
      isAdmin: true,
    });

    const response = await GET(
      new Request("http://localhost/api/auth/me") as never,
    );

    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: null,
        token: "api-token",
        isAdmin: true,
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.findUserByToken).not.toHaveBeenCalled();
  });
});

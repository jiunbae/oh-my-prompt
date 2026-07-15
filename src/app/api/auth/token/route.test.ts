import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return {
    requireAuth: vi.fn(),
    select: vi.fn(() => ({ from })),
    limit,
  };
});

vi.mock("@/lib/with-auth", () => ({
  AuthError: class AuthError extends Error {
    status = 401 as const;
  },
  requireAuth: mocks.requireAuth,
}));

vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/db/schema", () => ({ users: { id: "id", token: "token" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { GET } from "./route";

describe("GET /api/auth/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
  });

  it("reveals the current user's token without allowing it to be cached", async () => {
    mocks.limit.mockResolvedValue([{ token: "api-token" }]);

    const response = await GET();

    await expect(response.json()).resolves.toEqual({ token: "api-token" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 404 when the session user no longer exists", async () => {
    mocks.limit.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "User not found" });
  });
});

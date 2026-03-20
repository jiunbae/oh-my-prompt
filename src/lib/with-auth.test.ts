import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  parseSessionTokenMock,
  eqMock,
  limitMock,
  selectMock,
} = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    cookiesMock: vi.fn(),
    parseSessionTokenMock: vi.fn(),
    eqMock: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    limitMock: limit,
    selectMock: select,
  };
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "auth_session",
  parseSessionToken: parseSessionTokenMock,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@/db/schema", () => ({
  users: {
    id: "id",
    isAdmin: "is_admin",
    passwordChangedAt: "password_changed_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: eqMock,
}));

import { requireAdmin, requireAuth } from "@/lib/with-auth";

describe("with-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: passwordChangedAt is null (never changed), isAdmin false
    limitMock.mockResolvedValue([{ passwordChangedAt: null, isAdmin: false }]);
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: "token" })),
    });
    parseSessionTokenMock.mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
      token: "api-token",
      isAdmin: false,
      iat: Date.now(),
    });
  });

  it("returns 401 when no session cookie is present", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn(() => undefined) });

    await expect(requireAuth()).rejects.toMatchObject({
      name: "AuthError",
      message: "Not authenticated",
      status: 401,
    });
  });

  it("returns 401 when session token is invalid", async () => {
    parseSessionTokenMock.mockReturnValue(null);

    await expect(requireAuth()).rejects.toMatchObject({
      name: "AuthError",
      message: "Invalid session",
      status: 401,
    });
  });

  it("returns 401 when session was issued before password change", async () => {
    const passwordChangedAt = new Date();
    const iatBeforeChange = passwordChangedAt.getTime() - 60_000; // 1 minute before

    parseSessionTokenMock.mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
      token: "api-token",
      isAdmin: false,
      iat: iatBeforeChange,
    });
    limitMock.mockResolvedValue([{ passwordChangedAt }]);

    await expect(requireAuth()).rejects.toMatchObject({
      name: "AuthError",
      message: "Session invalidated by password change",
      status: 401,
    });
  });

  it("allows session issued after password change", async () => {
    const passwordChangedAt = new Date(Date.now() - 60_000); // 1 minute ago
    const iatAfterChange = Date.now();

    parseSessionTokenMock.mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
      token: "api-token",
      isAdmin: false,
      iat: iatAfterChange,
    });
    limitMock.mockResolvedValue([{ passwordChangedAt }]);

    await expect(requireAuth()).resolves.toMatchObject({
      userId: "user-1",
      email: "user@example.com",
    });
  });

  it("returns 403 when authenticated user is not admin in DB", async () => {
    // First call: passwordChangedAt check, second call: isAdmin check
    limitMock
      .mockResolvedValueOnce([{ passwordChangedAt: null }])
      .mockResolvedValueOnce([{ isAdmin: false }]);

    await expect(requireAdmin()).rejects.toMatchObject({
      name: "AuthError",
      message: "Admin access required",
      status: 403,
    });
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(eqMock).toHaveBeenCalled();
  });

  it("allows admin when DB says isAdmin=true", async () => {
    // First call: passwordChangedAt check, second call: isAdmin check
    limitMock
      .mockResolvedValueOnce([{ passwordChangedAt: null }])
      .mockResolvedValueOnce([{ isAdmin: true }]);

    await expect(requireAdmin()).resolves.toMatchObject({
      userId: "user-1",
      email: "user@example.com",
    });
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});

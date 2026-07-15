import { beforeEach, describe, expect, it, vi } from "vitest";

const { eqMock, limitMock, parseSessionTokenMock, selectMock } = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    eqMock: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    limitMock: limit,
    parseSessionTokenMock: vi.fn(),
    selectMock: select,
  };
});

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

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "auth_session",
  parseSessionToken: parseSessionTokenMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: eqMock,
}));

import { createTRPCContext } from "@/server/trpc";

describe("createTRPCContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseSessionTokenMock.mockReturnValue(null);
  });

  it("returns null user when request has no auth headers", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });

    expect(ctx.user).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects forged identity headers without a signed session cookie", async () => {
    const headers = new Headers({
      "x-user-id": "user-1",
      "x-user-email": "user@example.com",
      "x-user-is-admin": "true",
    });

    const ctx = await createTRPCContext({ headers });

    expect(ctx.user).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("uses the signed cookie and DB role instead of forwarded admin claims", async () => {
    parseSessionTokenMock.mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
      isAdmin: false,
      iat: Date.now(),
    });
    limitMock
      .mockResolvedValueOnce([{ passwordChangedAt: null }])
      .mockResolvedValueOnce([{ isAdmin: false }]);
    const headers = new Headers({
      cookie: "auth_session=signed-token",
      "x-user-id": "forged-admin",
      "x-user-is-admin": "true",
    });

    const ctx = await createTRPCContext({ headers });

    expect(ctx.user!.id).toBe("user-1");
    expect(ctx.user!.email).toBe("user@example.com");
    // isAdmin is lazy — must resolve first
    expect(ctx.user!.isAdmin).toBeUndefined();
    const isAdmin = await ctx.user!.resolveIsAdmin();
    expect(isAdmin).toBe(false);
    expect(ctx.user!.isAdmin).toBe(false);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("returns isAdmin=true when DB reports admin", async () => {
    parseSessionTokenMock.mockReturnValue({
      userId: "admin-1",
      email: "admin@example.com",
      isAdmin: false,
      iat: Date.now(),
    });
    limitMock
      .mockResolvedValueOnce([{ passwordChangedAt: null }])
      .mockResolvedValueOnce([{ isAdmin: true }]);
    const headers = new Headers({ cookie: "auth_session=signed-token" });

    const ctx = await createTRPCContext({ headers });

    expect(ctx.user!.id).toBe("admin-1");
    expect(ctx.user!.email).toBe("admin@example.com");
    const isAdmin = await ctx.user!.resolveIsAdmin();
    expect(isAdmin).toBe(true);
    expect(ctx.user!.isAdmin).toBe(true);
  });
});

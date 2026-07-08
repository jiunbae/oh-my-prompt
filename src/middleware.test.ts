import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function request(pathname: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("middleware", () => {
  it("allows the health endpoint without auth", async () => {
    const response = await middleware(request("/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows token-auth access to /api/auth/me", async () => {
    const response = await middleware(
      request("/api/auth/me", { "X-User-Token": "api-token" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects /api/auth/me without a token or session", async () => {
    const response = await middleware(request("/api/auth/me"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
  });
});

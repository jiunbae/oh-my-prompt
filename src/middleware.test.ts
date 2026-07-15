import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function request(pathname: string, headers?: HeadersInit) {
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("middleware", () => {
  it("allows the landing page without auth", async () => {
    const response = await proxy(request("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not treat every page as public when the root route is public", async () => {
    const response = await proxy(request("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows the health endpoint without auth", async () => {
    const response = await proxy(request("/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the readiness endpoint without auth", async () => {
    const response = await proxy(request("/api/ready"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows token-auth access to /api/auth/me", async () => {
    const response = await proxy(
      request("/api/auth/me", { "X-User-Token": "api-token" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows token-auth access to semantic search", async () => {
    const response = await proxy(
      request("/api/search/semantic", { "X-User-Token": "api-token" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects semantic search without a token or session", async () => {
    const response = await proxy(request("/api/search/semantic"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
  });

  it("rejects /api/auth/me without a token or session", async () => {
    const response = await proxy(request("/api/auth/me"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated",
    });
  });
});

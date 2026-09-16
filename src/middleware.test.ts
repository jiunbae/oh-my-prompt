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

describe("scheduler routes", () => {
  // These handlers implement SCHEDULER_TOKEN auth themselves, but the proxy
  // runs first. Before this passthrough existed it answered 401 for every
  // cookie-less /api/ request, so a cron could not reach them at all and
  // scheduled work silently never ran.
  const schedulerPaths = ["/api/admin/scheduled-jobs/run", "/api/admin/usage/flush"];

  for (const path of schedulerPaths) {
    it(`lets ${path} through when X-Scheduler-Token is present`, async () => {
      const response = await proxy(request(path, { "X-Scheduler-Token": "whatever" }));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it(`lets ${path} through with a bearer token`, async () => {
      const response = await proxy(request(path, { Authorization: "Bearer whatever" }));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it(`still rejects ${path} with no credential at all`, async () => {
      // Passing through is not authenticating -- without a header there is
      // nothing for the handler to check, so the proxy answers as before.
      const response = await proxy(request(path));

      expect(response.status).toBe(401);
    });
  }

  it("does not open neighbouring admin routes", async () => {
    const response = await proxy(
      request("/api/admin/diagnostics", { "X-Scheduler-Token": "whatever" })
    );

    expect(response.status).toBe(401);
  });

  it("does not open a path that merely starts with a scheduler route name", async () => {
    const response = await proxy(
      request("/api/admin/usage/flush-everything", { "X-Scheduler-Token": "whatever" })
    );

    expect(response.status).toBe(401);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, pingMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  pingMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute: executeMock },
}));

vi.mock("@/lib/redis", () => ({
  redis: { ping: pingMock },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

import { GET } from "./route";

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("QUEUE_ENABLED", "false");
    executeMock.mockResolvedValue([]);
    pingMock.mockResolvedValue("PONG");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("checks the database and skips Redis when queues are disabled", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledOnce();
    expect(pingMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("checks Redis when queues are enabled", async () => {
    vi.stubEnv("QUEUE_ENABLED", "true");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(pingMock).toHaveBeenCalledOnce();
  });

  it("returns 503 when a required dependency is unavailable", async () => {
    executeMock.mockRejectedValue(new Error("database offline"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Service dependencies are unavailable",
    });
  });
});

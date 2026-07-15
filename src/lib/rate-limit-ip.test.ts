import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
  redis: {
    defineCommand: vi.fn(),
    status: "end",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { getAuthRateLimitKey, getClientIp } from "@/lib/rate-limit";

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

describe("getClientIp", () => {
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it("ignores spoofable proxy headers by default", () => {
    expect(getClientIp(request({ "x-forwarded-for": "203.0.113.10" }))).toBe("unknown");
    expect(getClientIp(request({ "x-real-ip": "203.0.113.10" }))).toBe("unknown");
  });

  it("uses the right-most client entry behind one trusted proxy", () => {
    expect(
      getClientIp(
        request({ "x-forwarded-for": "198.51.100.20, 203.0.113.10" }),
        1,
      ),
    ).toBe("203.0.113.10");
  });

  it("hashes auth identities so direct deployments do not share one low-volume bucket", () => {
    const first = getAuthRateLimitKey("unknown", "User@Example.com");
    const same = getAuthRateLimitKey("unknown", " user@example.com ");
    const second = getAuthRateLimitKey("unknown", "other@example.com");

    expect(first).toBe(same);
    expect(first).not.toBe(second);
    expect(first).not.toContain("user@example.com");
  });
});

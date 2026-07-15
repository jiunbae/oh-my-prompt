import { describe, expect, it } from "vitest";
import { buildEventKey } from "./event-key";

describe("buildEventKey", () => {
  it("uses the stable user id namespace and never the API token", () => {
    const key = buildEventKey(
      "8dfd95db-d2fd-41c7-a333-b32d4c295567",
      new Date("2026-07-15T23:59:58.000Z"),
      "event/with unsafe chars",
    );

    expect(key).toBe(
      "8dfd95db-d2fd-41c7-a333-b32d4c295567/2026/07/15/event_with_unsafe_chars.json",
    );
    expect(key).not.toContain("api-token");
  });

  it("is deterministic for duplicate uploads", () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    expect(buildEventKey("user-1", createdAt, "event-1")).toBe(
      buildEventKey("user-1", createdAt, "event-1"),
    );
  });
});

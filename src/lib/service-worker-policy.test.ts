import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("service worker privacy policy", () => {
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

  it("does not persist authenticated API responses", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).not.toContain("omp-api-cache");
    expect(source).not.toContain("API_CACHE");
  });

  it("does not pre-cache authenticated pages or claim fake background sync", () => {
    const staticAssets = source.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)?.[1] ?? "";
    expect(staticAssets).not.toContain('"/"');
    expect(staticAssets).not.toContain('"/dashboard"');
    expect(source).not.toContain('addEventListener("sync"');
    expect(source).not.toContain("sync-complete");
  });
});

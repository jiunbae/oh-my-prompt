import { describe, it, expect } from "vitest";
import { redactText } from "../redact";

describe("redactText", () => {
  it("returns empty string for falsy input", () => {
    expect(redactText("")).toEqual({ text: "", count: 0 });
  });

  it("returns original text when no secrets found", () => {
    const input = "Fix the login bug in auth.ts";
    const result = redactText(input);
    expect(result.text).toBe(input);
    expect(result.count).toBe(0);
  });

  it("redacts OpenAI API keys", () => {
    const input = "Use sk-abcdefghijklmnopqrstuvwxyz1234 for auth";
    const result = redactText(input);
    expect(result.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
    expect(result.count).toBe(1);
  });

  it("redacts GitHub tokens", () => {
    const input = "Token: ghp_abcdefghijklmnopqrstuvwxyz1234";
    const result = redactText(input);
    expect(result.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234");
    expect(result.count).toBe(1);
  });

  it("redacts GitHub PATs", () => {
    const input = "github_pat_abcdefghijklmnopqrstuvwxyz1234";
    const result = redactText(input);
    expect(result.text).not.toContain("github_pat_abcdefghijklmnopqrstuvwxyz1234");
    expect(result.count).toBe(1);
  });

  it("redacts AWS access keys", () => {
    const input = "AKIAIOSFODNN7EXAMPLE";
    const result = redactText(input);
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.count).toBe(1);
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.payload.signature";
    const result = redactText(input);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it("redacts Stripe keys", () => {
    // Build key dynamically to avoid GitHub push protection false positive
    const prefix = ["sk", "live"].join("_") + "_";
    const input = prefix + "A".repeat(24);
    const result = redactText(input);
    expect(result.text).not.toContain(input);
    expect(result.count).toBe(1);
  });

  it("redacts Slack tokens", () => {
    // Build token dynamically to avoid GitHub push protection false positive
    const prefix = ["xoxb", "0000000000"].join("-") + "-";
    const input = prefix + "A".repeat(24);
    const result = redactText(input);
    expect(result.text).not.toContain(input);
    expect(result.count).toBe(1);
  });

  it("redacts Google API keys", () => {
    const input = "AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe";
    const result = redactText(input);
    expect(result.text).not.toContain("AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe");
    expect(result.count).toBe(1);
  });

  it("redacts private keys", () => {
    const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const result = redactText(input);
    expect(result.text).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.count).toBe(1);
  });

  it("redacts multiple secrets in one text", () => {
    const input = "Keys: sk-abcdefghijklmnopqrstuvwxyz1234 and AKIAIOSFODNN7EXAMPLE";
    const result = redactText(input);
    expect(result.count).toBe(2);
  });

  it("uses custom mask", () => {
    const input = "sk-abcdefghijklmnopqrstuvwxyz1234";
    const result = redactText(input, { mask: "***" });
    expect(result.text).toContain("***");
  });

  it("handles JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactText(jwt);
    expect(result.text).not.toContain("eyJhbGci");
    expect(result.count).toBe(1);
  });
});

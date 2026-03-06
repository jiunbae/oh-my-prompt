import { describe, it, expect } from "vitest";
import { postprocessUploadRecordForDb } from "../upload-postprocess";
import type { UploadRecord } from "../upload-types";

function makeRecord(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    event_id: "test-1",
    created_at: "2026-01-01T00:00:00Z",
    prompt_text: "Fix the login bug in auth.ts",
    prompt_length: 28,
    ...overrides,
  };
}

describe("postprocessUploadRecordForDb", () => {
  it("computes prompt metrics correctly", () => {
    const result = postprocessUploadRecordForDb(makeRecord(), {
      redactEnabled: false,
      redactMask: "[REDACTED]",
    });

    expect(result.promptText).toBe("Fix the login bug in auth.ts");
    expect(result.promptLength).toBe(28);
    expect(result.tokenEstimate).toBe(Math.ceil(28 / 4));
    expect(result.wordCount).toBe(6);
    expect(result.responseText).toBeUndefined();
    expect(result.responseLength).toBeUndefined();
    expect(result.tokenEstimateResponse).toBeUndefined();
    expect(result.wordCountResponse).toBeUndefined();
  });

  it("computes response metrics when response_text is present", () => {
    const responseText = "I fixed the bug by updating the session logic.";
    const result = postprocessUploadRecordForDb(
      makeRecord({ response_text: responseText }),
      { redactEnabled: false, redactMask: "[REDACTED]" },
    );

    expect(result.responseText).toBe(responseText);
    expect(result.responseLength).toBe(responseText.length);
    expect(result.tokenEstimateResponse).toBe(Math.ceil(responseText.length / 4));
    expect(result.wordCountResponse).toBe(9);
  });

  it("handles null response_text", () => {
    const result = postprocessUploadRecordForDb(
      makeRecord({ response_text: null }),
      { redactEnabled: false, redactMask: "[REDACTED]" },
    );

    expect(result.responseText).toBeUndefined();
    expect(result.tokenEstimateResponse).toBeUndefined();
  });

  it("redacts sensitive data from prompt when enabled", () => {
    const record = makeRecord({
      prompt_text: "Use sk-abcdefghijklmnopqrstuvwxyz1234 as the key",
    });
    const result = postprocessUploadRecordForDb(record, {
      redactEnabled: true,
      redactMask: "[MASKED]",
    });

    expect(result.promptText).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
    expect(result.promptText).toContain("[MASKED]");
  });

  it("redacts sensitive data from response when enabled", () => {
    const record = makeRecord({
      response_text: "Set AKIA1234567890123456 in your config",
    });
    const result = postprocessUploadRecordForDb(record, {
      redactEnabled: true,
      redactMask: "[REDACTED]",
    });

    expect(result.responseText).not.toContain("AKIA1234567890123456");
    expect(result.responseText).toContain("[REDACTED]");
  });

  it("does not redact when disabled", () => {
    const text = "Use sk-abcdefghijklmnopqrstuvwxyz1234 as the key";
    const result = postprocessUploadRecordForDb(
      makeRecord({ prompt_text: text }),
      { redactEnabled: false, redactMask: "[REDACTED]" },
    );

    expect(result.promptText).toBe(text);
  });

  it("handles empty prompt text", () => {
    const result = postprocessUploadRecordForDb(
      makeRecord({ prompt_text: "" }),
      { redactEnabled: false, redactMask: "[REDACTED]" },
    );

    expect(result.promptText).toBe("");
    expect(result.promptLength).toBe(0);
    expect(result.tokenEstimate).toBe(0);
    expect(result.wordCount).toBe(0);
  });
});

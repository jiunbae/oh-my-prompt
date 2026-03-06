import { describe, it, expect } from "vitest";
import { lintPrompt } from "../prompt-lint";
import type { LintResult } from "../prompt-lint";

function findRule(results: LintResult[], id: string): LintResult | undefined {
  return results.find((r) => r.id === id);
}

describe("lintPrompt", () => {
  it("returns empty array for empty text", () => {
    expect(lintPrompt("")).toEqual([]);
    expect(lintPrompt("  ")).toEqual([]);
  });

  // ── vague-instruction ─────────────────────────────────────────

  describe("vague-instruction", () => {
    it("flags standalone vague prompts as error", () => {
      const results = lintPrompt("fix this");
      const rule = findRule(results, "vague-instruction");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("error");
    });

    it("flags vague phrases in longer prompts as warning", () => {
      const results = lintPrompt(
        "I have a bug in the auth module, can you fix this and make it better? The login flow is broken.",
      );
      const rule = findRule(results, "vague-instruction");
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe("warning");
    });

    it("does not flag specific instructions", () => {
      const results = lintPrompt(
        "Refactor the parseConfig() function in src/config.ts to use zod validation",
      );
      const rule = findRule(results, "vague-instruction");
      expect(rule).toBeUndefined();
    });
  });

  // ── missing-context ───────────────────────────────────────────

  describe("missing-context", () => {
    it("flags prompts with no code references", () => {
      const results = lintPrompt(
        "Add better error handling to the application",
      );
      const rule = findRule(results, "missing-context");
      expect(rule).toBeDefined();
    });

    it("does not flag prompts with file paths", () => {
      const results = lintPrompt(
        "Add error handling to src/services/upload.ts",
      );
      const rule = findRule(results, "missing-context");
      expect(rule).toBeUndefined();
    });

    it("does not flag prompts with function references", () => {
      const results = lintPrompt(
        "The processUpload() function is missing error handling for invalid dates",
      );
      const rule = findRule(results, "missing-context");
      expect(rule).toBeUndefined();
    });

    it("does not flag prompts with backtick code references", () => {
      const results = lintPrompt(
        "Update the `userId` field to be required",
      );
      const rule = findRule(results, "missing-context");
      expect(rule).toBeUndefined();
    });
  });

  // ── too-broad-scope ───────────────────────────────────────────

  describe("too-broad-scope", () => {
    it("flags prompts with many unrelated tasks", () => {
      const results = lintPrompt(
        "Fix the login bug and also add a new dashboard page, additionally refactor the database queries and then deploy to production",
      );
      const rule = findRule(results, "too-broad-scope");
      expect(rule).toBeDefined();
    });

    it("does not flag focused prompts", () => {
      const results = lintPrompt(
        "Fix the login bug in auth.ts by checking for null tokens before calling validate()",
      );
      const rule = findRule(results, "too-broad-scope");
      expect(rule).toBeUndefined();
    });
  });

  // ── no-verification-criteria ──────────────────────────────────

  describe("no-verification-criteria", () => {
    it("flags longer prompts without success criteria", () => {
      const results = lintPrompt(
        "I need you to refactor the entire authentication module in our application to use a new token-based approach with refresh tokens and session management",
      );
      const rule = findRule(results, "no-verification-criteria");
      expect(rule).toBeDefined();
    });

    it("does not flag prompts with verification criteria", () => {
      const results = lintPrompt(
        "Refactor the auth module so that all existing tests should pass and the login endpoint returns a JWT token",
      );
      const rule = findRule(results, "no-verification-criteria");
      expect(rule).toBeUndefined();
    });

    it("does not flag short prompts", () => {
      const results = lintPrompt("Fix the login bug");
      const rule = findRule(results, "no-verification-criteria");
      expect(rule).toBeUndefined();
    });
  });

  // ── missing-constraints ───────────────────────────────────────

  describe("missing-constraints", () => {
    it("flags long prompts without any constraints", () => {
      const results = lintPrompt(
        "I need a new feature that allows users to upload images and then process them with various filters and transformations. The images should be stored somewhere and retrieved later for display in a gallery view.",
      );
      const rule = findRule(results, "missing-constraints");
      expect(rule).toBeDefined();
    });

    it("does not flag prompts with constraint language", () => {
      const results = lintPrompt(
        "I need a new feature that allows users to upload images. We must use TypeScript and should not add external dependencies. Avoid using any deprecated APIs and limit file size to 5MB.",
      );
      const rule = findRule(results, "missing-constraints");
      expect(rule).toBeUndefined();
    });

    it("does not flag short prompts", () => {
      const results = lintPrompt("Add a login button");
      const rule = findRule(results, "missing-constraints");
      expect(rule).toBeUndefined();
    });
  });

  // ── wall-of-text ──────────────────────────────────────────────

  describe("wall-of-text", () => {
    it("flags long unstructured text", () => {
      // Generate a wall of text > 2000 chars
      const wall = "This is a sentence about the application. ".repeat(60);
      expect(wall.length).toBeGreaterThan(2000);
      const results = lintPrompt(wall);
      const rule = findRule(results, "wall-of-text");
      expect(rule).toBeDefined();
    });

    it("does not flag long text with bullet points", () => {
      const structured =
        "Background context about the project.\n" +
        "- First requirement for the feature\n" +
        "- Second requirement for the feature\n" +
        "a ".repeat(1000);
      expect(structured.length).toBeGreaterThan(2000);
      const results = lintPrompt(structured);
      const rule = findRule(results, "wall-of-text");
      expect(rule).toBeUndefined();
    });

    it("does not flag short text", () => {
      const results = lintPrompt("Short prompt without structure.");
      const rule = findRule(results, "wall-of-text");
      expect(rule).toBeUndefined();
    });
  });

  // ── Integration tests ─────────────────────────────────────────

  describe("integration", () => {
    it("returns multiple lint results for a bad prompt", () => {
      const results = lintPrompt(
        "Fix this and also make it better and then do something about the performance",
      );
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Should at least have vague-instruction
      expect(findRule(results, "vague-instruction")).toBeDefined();
    });

    it("returns zero results for a well-crafted prompt", () => {
      const results = lintPrompt(
        "Refactor `processUpload()` in src/services/upload.ts to validate the `created_at` field before constructing the Date object. " +
          "Currently it only checks for NaN after construction, but we should also reject obviously invalid strings. " +
          "Use zod's `z.string().datetime()` for validation. " +
          "The existing tests in upload-postprocess.test.ts should still pass after this change.",
      );
      expect(results).toEqual([]);
    });

    it("each result has required fields", () => {
      const results = lintPrompt("do something");
      for (const r of results) {
        expect(r.id).toBeDefined();
        expect(["warning", "error"]).toContain(r.severity);
        expect(r.message).toBeTruthy();
        expect(r.suggestion).toBeTruthy();
      }
    });
  });
});

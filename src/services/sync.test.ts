import { describe, it, expect } from "vitest";
import { extractProjectName, detectPromptType, estimateTokens, classifyPrompt } from "./sync";

describe("sync services", () => {
  describe("classifyPrompt", () => {
    it("should classify debugging prompts", () => {
      const text = "Fix this error in the login flow";
      expect(classifyPrompt(text)).toContain("debugging");
    });

    it("should classify multiple categories", () => {
      const text = "Add a new feature to the database query logic";
      const tags = classifyPrompt(text);
      expect(tags).toContain("feature");
      expect(tags).toContain("database");
    });

    it("should return empty array for unrelated text", () => {
      const text = "Just saying hello";
      expect(classifyPrompt(text)).toEqual([]);
    });
  });

  describe("extractProjectName", () => {
    it("should extract project name from a standard workspace path", () => {
      const path = "/Users/username/workspace/my-awesome-project/src/main.ts";
      expect(extractProjectName(path)).toBe("my-awesome-project");
    });

    it("should return null for non-workspace paths", () => {
      const path = "/etc/hosts";
      expect(extractProjectName(path)).toBeNull();
    });
  });

  describe("detectPromptType", () => {
    it("should detect task_notification", () => {
      const prompt = "Some text <task-notification> more text";
      expect(detectPromptType(prompt)).toBe("task_notification");
    });

    it("should detect system prompt", () => {
      const prompt = "System: <system-reminder>";
      expect(detectPromptType(prompt)).toBe("system");
    });

    it("should default to user_input", () => {
      const prompt = "Hello world";
      expect(detectPromptType(prompt)).toBe("user_input");
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens based on length / 4", () => {
      expect(estimateTokens("1234")).toBe(1);
      expect(estimateTokens("12345678")).toBe(2);
    });
  });
});

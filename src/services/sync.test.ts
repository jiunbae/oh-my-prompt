import { describe, it, expect } from "vitest";
import { extractProjectName, detectPromptType, estimateTokens } from "./sync";

describe("sync services", () => {
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

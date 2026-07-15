import { describe, expect, it } from "vitest";
import { sanitizeIntegrationPayload } from "@/lib/integration-payload";

describe("sanitizeIntegrationPayload", () => {
  it("keeps event metadata while removing captured prompt bodies", () => {
    expect(
      sanitizeIntegrationPayload({
        promptId: "prompt-1",
        projectName: "omp",
        promptText: "private prompt",
        responseText: "private response",
      }),
    ).toEqual({ promptId: "prompt-1", projectName: "omp" });
  });

  it("removes camelCase and snake_case prompt bodies recursively", () => {
    expect(
      sanitizeIntegrationPayload({
        nested: {
          prompt_text: "private prompt",
          response_text: "private response",
          safe: true,
        },
        items: [{ promptText: "private", id: "safe-id" }],
      }),
    ).toEqual({ nested: { safe: true }, items: [{ id: "safe-id" }] });
  });
});

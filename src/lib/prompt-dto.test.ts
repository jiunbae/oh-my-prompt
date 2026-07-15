import { describe, expect, it } from "vitest";
import { toPromptDto } from "./prompt-dto";

describe("toPromptDto", () => {
  it("does not expose idempotency keys or search storage fields", () => {
    const row = {
      id: "prompt-1",
      eventKey: "secret-api-token/2026/07/15/event.json",
      timestamp: new Date("2026-07-15T00:00:00Z"),
      workingDirectory: null,
      promptLength: 5,
      promptText: "hello",
      responseText: null,
      responseLength: null,
      projectName: null,
      promptType: "user_input",
      source: null,
      sessionId: null,
      deviceName: null,
      userId: "user-1",
      teamId: null,
      tokenEstimate: null,
      wordCount: null,
      tokenEstimateResponse: null,
      wordCountResponse: null,
      syncedAt: null,
      updatedAt: null,
      qualityScore: null,
      qualityClarity: null,
      qualitySpecificity: null,
      qualityContext: null,
      qualityConstraints: null,
      qualityStructure: null,
      qualityDetails: null,
      topicTags: null,
      enrichedAt: null,
      searchVector: "private search vector",
      embedding: [0.1],
      deletedAt: null,
      visibility: "private",
    } as never;

    const dto = toPromptDto(row);

    expect(dto).toMatchObject({ id: "prompt-1", promptText: "hello" });
    expect(dto).not.toHaveProperty("eventKey");
    expect(dto).not.toHaveProperty("searchVector");
    expect(dto).not.toHaveProperty("embedding");
    expect(dto).not.toHaveProperty("deletedAt");
  });
});

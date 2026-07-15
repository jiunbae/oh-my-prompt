import type { prompts } from "@/db/schema";

type PromptRow = typeof prompts.$inferSelect;

/**
 * Public prompt representation.
 *
 * Keep this as an allowlist: eventKey is an internal idempotency key and
 * searchVector/embedding are storage details that must not cross API boundaries.
 */
export function toPromptDto(prompt: PromptRow) {
  return {
    id: prompt.id,
    timestamp: prompt.timestamp,
    workingDirectory: prompt.workingDirectory,
    promptLength: prompt.promptLength,
    promptText: prompt.promptText,
    responseText: prompt.responseText,
    responseLength: prompt.responseLength,
    projectName: prompt.projectName,
    promptType: prompt.promptType,
    source: prompt.source,
    sessionId: prompt.sessionId,
    deviceName: prompt.deviceName,
    userId: prompt.userId,
    teamId: prompt.teamId,
    tokenEstimate: prompt.tokenEstimate,
    wordCount: prompt.wordCount,
    tokenEstimateResponse: prompt.tokenEstimateResponse,
    wordCountResponse: prompt.wordCountResponse,
    syncedAt: prompt.syncedAt,
    updatedAt: prompt.updatedAt,
    qualityScore: prompt.qualityScore,
    qualityClarity: prompt.qualityClarity,
    qualitySpecificity: prompt.qualitySpecificity,
    qualityContext: prompt.qualityContext,
    qualityConstraints: prompt.qualityConstraints,
    qualityStructure: prompt.qualityStructure,
    qualityDetails: prompt.qualityDetails,
    topicTags: prompt.topicTags,
    enrichedAt: prompt.enrichedAt,
    visibility: prompt.visibility,
  };
}

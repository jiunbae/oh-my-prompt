import type { ProcessorInput, InsightResult } from "../types";

export async function handler(_input: ProcessorInput): Promise<InsightResult> {
  // Stub — will be implemented in Phase 3
  return {
    title: "Prompt Quality",
    summary: "Extension not yet configured. Set OMP_LLM_PROVIDER to enable.",
    confidence: 0,
    generatedAt: new Date().toISOString(),
  };
}

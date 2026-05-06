import type { ProcessorInput, InsightResult } from "../types";
import { evaluateAlertRules } from "@/lib/alerts";

export async function handler(_input: ProcessorInput): Promise<InsightResult> {
  const result = await evaluateAlertRules();

  return {
    title: "Alert Rule Evaluation",
    summary: `Evaluated ${result.evaluated} alert rules. ${result.triggered} triggered. ${result.errors} errors.`,
    highlights: [
      { label: "Rules Evaluated", value: result.evaluated },
      { label: "Triggered", value: result.triggered },
      { label: "Errors", value: result.errors },
    ],
    confidence: 1,
    generatedAt: new Date().toISOString(),
  };
}

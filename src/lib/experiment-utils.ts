import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { Prompt, PromptExperiment } from "@/db/schema";

export function calculateMetricValue(prompt: Prompt, metric: string): number | null {
  switch (metric) {
    case "quality_score":
      return prompt.qualityScore;
    case "clarity":
      return prompt.qualityClarity;
    case "specificity":
      return prompt.qualitySpecificity;
    case "context":
      return prompt.qualityContext;
    case "constraints":
      return prompt.qualityConstraints;
    case "structure":
      return prompt.qualityStructure;
    case "response_quality":
      return prompt.qualityScore;
    default:
      return prompt.qualityScore;
  }
}

export async function handleVersionForExperiments(
  promptId: string,
  versionNumber: number,
  prompt: Prompt
) {
  const runningExperiments = await db
    .select()
    .from(schema.promptExperiments)
    .where(
      and(
        eq(schema.promptExperiments.promptId, promptId),
        eq(schema.promptExperiments.status, "running")
      )
    );

  for (const experiment of runningExperiments) {
    if (
      versionNumber !== experiment.baselineVersion &&
      versionNumber !== experiment.challengerVersion
    ) {
      continue;
    }

    const metricValue = calculateMetricValue(prompt, experiment.winMetric ?? "quality_score");
    if (metricValue == null) continue;

    const [existing] = await db
      .select()
      .from(schema.experimentResults)
      .where(
        and(
          eq(schema.experimentResults.experimentId, experiment.id),
          eq(schema.experimentResults.version, versionNumber)
        )
      )
      .limit(1);

    if (existing) {
      const oldSampleSize = existing.sampleSize ?? 0;
      const oldMetric = existing.metricValue ? Number(existing.metricValue) : 0;
      const newSampleSize = oldSampleSize + 1;
      const newMetric =
        oldSampleSize === 0
          ? metricValue
          : (oldMetric * oldSampleSize + metricValue) / newSampleSize;

      await db
        .update(schema.experimentResults)
        .set({
          metricValue: String(newMetric),
          sampleSize: newSampleSize,
          recordedAt: new Date(),
        })
        .where(eq(schema.experimentResults.id, existing.id));
    } else {
      await db.insert(schema.experimentResults).values({
        experimentId: experiment.id,
        version: versionNumber,
        metricValue: String(metricValue),
        sampleSize: 1,
        recordedAt: new Date(),
      });
    }

    // Auto-conclude if both versions have >= minSamples
    const results = await db
      .select()
      .from(schema.experimentResults)
      .where(eq(schema.experimentResults.experimentId, experiment.id));

    const baselineResult = results.find((r) => r.version === experiment.baselineVersion);
    const challengerResult = results.find((r) => r.version === experiment.challengerVersion);

    const minSamples = experiment.minSamples ?? 10;
    const baselineSamples = baselineResult?.sampleSize ?? 0;
    const challengerSamples = challengerResult?.sampleSize ?? 0;

    if (baselineSamples >= minSamples && challengerSamples >= minSamples) {
      const baselineAvg = baselineResult?.metricValue ? Number(baselineResult.metricValue) : 0;
      const challengerAvg = challengerResult?.metricValue ? Number(challengerResult.metricValue) : 0;

      let winnerVersion: number | null = null;
      if (baselineAvg > challengerAvg) {
        winnerVersion = experiment.baselineVersion;
      } else if (challengerAvg > baselineAvg) {
        winnerVersion = experiment.challengerVersion;
      }

      await db
        .update(schema.promptExperiments)
        .set({
          status: "completed",
          endedAt: new Date(),
          winnerVersion,
        })
        .where(eq(schema.promptExperiments.id, experiment.id));
    }
  }
}

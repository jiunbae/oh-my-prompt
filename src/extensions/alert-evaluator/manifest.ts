import type { Extension } from "../types";
import { handler } from "./processor";

export const alertEvaluator: Extension = {
  name: "alert-evaluator",
  version: "1.0.0",
  description: "Evaluates user-defined alert rules for prompt metrics and sends notifications via email, Slack, or in-app",
  cacheTtlHours: 1,
  processor: {
    schedule: "0 */6 * * *", // Every 6 hours
    jobName: "alerts:evaluate-rules",
    handler,
  },
};

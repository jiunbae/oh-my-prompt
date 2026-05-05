import type { Extension } from "../types";
import { handler } from "./processor";

export const slackDaily: Extension = {
  name: "slack-daily",
  version: "1.0.0",
  description: "Daily Slack summary delivered at 5:00 PM with prompt activity, projects, and token usage",
  cacheTtlHours: 24,
  processor: {
    schedule: "0 17 * * *", // 5:00 PM daily
    jobName: "slack:daily-summary",
    handler,
  },
};

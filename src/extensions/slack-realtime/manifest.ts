import type { Extension } from "../types";

export const slackRealtime: Extension = {
  name: "slack-realtime",
  version: "1.0.0",
  description: "Realtime Slack notifications triggered on prompt creation",
  cacheTtlHours: 24,
  // No schedule — triggered by prompt creation in upload.ts
};

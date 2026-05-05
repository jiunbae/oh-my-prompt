import type { Extension } from "../types";
import { handler } from "./processor";

export const emailDigest: Extension = {
  name: "email-digest",
  version: "1.0.0",
  description: "Weekly email digest with prompt activity summary, quality trends, and project breakdown",
  cacheTtlHours: 24,
  processor: {
    schedule: "0 9 * * 1", // Monday 9:00 AM
    jobName: "email:weekly-digest",
    handler,
  },
};

import { Queue } from "bullmq";
import { redis } from "./redis";

export const syncQueue = new Queue("sync-queue", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export type SyncJobData = {
  userId: string;
  userToken: string;
  syncType: "manual" | "auto" | "cron";
  incremental?: boolean;
  since?: string;
};

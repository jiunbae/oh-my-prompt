import { Worker, Job } from "bullmq";
import { redis } from "@/lib/redis";
import { syncAll, syncIncremental } from "./sync";
import { SyncJobData } from "@/lib/queue";
import { logger } from "@/lib/logger";

export const syncWorker = new Worker(
  "sync-queue",
  async (job: Job<SyncJobData>) => {
    const { userId, userToken, syncType, incremental, since } = job.data;
    
    logger.info({ jobId: job.id, userId, syncType }, "Starting sync job");

    try {
      let result: any;
      if (incremental && since) {
        result = await syncIncremental(new Date(since), {
          userId,
          userToken,
          syncType,
        });
      } else {
        result = await syncAll({
          userId,
          userToken,
          syncType,
        });
      }

      logger.info({ jobId: job.id, success: result.success }, "Sync job completed");
      return result;
    } catch (error) {
      logger.error({ jobId: job.id, error }, "Sync job failed");
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 1,
  }
);

syncWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Job completed successfully");
});

syncWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Job failed");
});

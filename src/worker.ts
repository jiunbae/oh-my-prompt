/**
 * BullMQ worker entrypoint.
 *
 * Runs as a separate process (its own container / k8s Deployment) from the
 * Next.js web server. Consumes the `omp:jobs` and `omp:webhooks` queues and
 * self-schedules the extension cron jobs, so scheduled work runs off the web
 * request thread with durable retries and idempotency.
 *
 * Bundled to a single self-contained file via `scripts/build-worker.mjs` and
 * launched with `node dist/worker.cjs`.
 */
import { Worker, type Job, type ConnectionOptions } from "bullmq";
import { writeFileSync } from "fs";
import { logger } from "@/lib/logger";
import {
  QUEUE_NAMES,
  JOB_NAMES,
  WEBHOOK_JOB_NAMES,
  createQueueConnection,
  registerSchedulers,
  enqueueRun,
  firingBucket,
  jobsQueue,
  webhooksQueue,
  type DispatchJobData,
  type RunJobData,
  type WebhookDeliverJobData,
} from "@/lib/queue";
import {
  getDistinctUserIds,
  isPerUserJob,
  runSingleProcessor,
} from "@/lib/scheduler";
import { runWebhookRetryAttempt } from "@/lib/webhook-retry";

const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE || "/tmp/omp-worker-heartbeat";
const JOBS_CONCURRENCY = Number(process.env.WORKER_JOBS_CONCURRENCY || 5);
const WEBHOOKS_CONCURRENCY = Number(process.env.WORKER_WEBHOOKS_CONCURRENCY || 10);

/**
 * Handle a repeatable `dispatch` tick: fan a per-user extension out to one
 * `run` job per user, or enqueue a single `run` for a global extension. Uses a
 * single firing bucket so a double tick within the hour dedupes downstream.
 */
async function handleDispatch(data: DispatchJobData): Promise<void> {
  const { jobName } = data;
  const bucket = firingBucket();

  if (isPerUserJob(jobName)) {
    const userIds = await getDistinctUserIds();
    logger.info({ jobName, users: userIds.length, bucket }, "Dispatching per-user job");
    for (const userId of userIds) {
      await enqueueRun({ jobName, userId }, bucket);
    }
    return;
  }

  logger.info({ jobName, bucket }, "Dispatching global job");
  await enqueueRun({ jobName }, bucket);
}

async function handleRun(data: RunJobData): Promise<void> {
  const result = await runSingleProcessor(data.jobName, {
    userId: data.userId,
    dateRange: data.dateRange,
  });
  if (!result.ran) {
    throw new Error(result.error || `Job ${data.jobName} did not run`);
  }
}

async function handleWebhookDeliver(data: WebhookDeliverJobData): Promise<void> {
  await runWebhookRetryAttempt({
    webhookId: data.webhookId,
    event: data.event,
    payload: data.payload as Record<string, unknown>,
    attempt: data.attempt,
    retryOfLogId: data.retryOfLogId,
  });
}

async function main() {
  logger.info("Starting oh-my-prompt worker...");

  // Self-schedule the extension cron jobs (idempotent across restarts).
  const registered = await registerSchedulers();
  logger.info({ schedulers: registered }, "Registered job schedulers");

  const jobsConnection = createQueueConnection();
  const webhooksConnection = createQueueConnection();

  const jobsWorker = new Worker(
    QUEUE_NAMES.jobs,
    async (job: Job) => {
      switch (job.name) {
        case JOB_NAMES.dispatch:
          return handleDispatch(job.data as DispatchJobData);
        case JOB_NAMES.run:
          return handleRun(job.data as RunJobData);
        default:
          logger.warn({ name: job.name }, "Unknown jobs-queue job name");
      }
    },
    {
      connection: jobsConnection as unknown as ConnectionOptions,
      concurrency: JOBS_CONCURRENCY,
    },
  );

  const webhooksWorker = new Worker(
    QUEUE_NAMES.webhooks,
    async (job: Job) => {
      if (job.name === WEBHOOK_JOB_NAMES.deliver) {
        return handleWebhookDeliver(job.data as WebhookDeliverJobData);
      }
      logger.warn({ name: job.name }, "Unknown webhooks-queue job name");
    },
    {
      connection: webhooksConnection as unknown as ConnectionOptions,
      concurrency: WEBHOOKS_CONCURRENCY,
    },
  );

  for (const [label, worker] of [
    ["jobs", jobsWorker],
    ["webhooks", webhooksWorker],
  ] as const) {
    worker.on("failed", (job, err) => {
      logger.error({ err, jobId: job?.id, name: job?.name, queue: label }, "Job failed");
    });
    worker.on("error", (err) => {
      logger.error({ err, queue: label }, "Worker error");
    });
  }

  // Liveness heartbeat for the k8s exec probe.
  const heartbeat = setInterval(() => {
    try {
      writeFileSync(HEARTBEAT_FILE, String(Date.now()));
    } catch {
      /* best-effort */
    }
  }, 15_000);
  heartbeat.unref();

  logger.info(
    { jobsConcurrency: JOBS_CONCURRENCY, webhooksConcurrency: WEBHOOKS_CONCURRENCY },
    "Worker ready",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down worker...");
    clearInterval(heartbeat);
    try {
      await Promise.all([jobsWorker.close(), webhooksWorker.close()]);
      await Promise.all([
        jobsQueue().close(),
        webhooksQueue().close(),
        jobsConnection.quit(),
        webhooksConnection.quit(),
      ]);
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});

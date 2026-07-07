import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/env";
import { logger } from "./logger";
import { APP_TIME_ZONE, dateTimePartsInTimeZone } from "./date-utils";
import { extensions } from "@/extensions/registry";

/**
 * BullMQ-backed job queues.
 *
 * The queue lets scheduled extension work (digests, Slack summaries, alert
 * evaluation) and webhook retries run in a dedicated worker process instead of
 * inline in the Next.js request thread. When `QUEUE_ENABLED` is false the app
 * falls back to the legacy inline execution path, so local dev without a worker
 * still works.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its Redis connections, and a
 * Worker *blocks* its connection while waiting for jobs — so queues and workers
 * must each get their own connection, never the shared rate-limit/cache client.
 */

export const QUEUE_ENABLED = env.QUEUE_ENABLED === "true";

export const QUEUE_NAMES = {
  jobs: "omp-jobs",
  webhooks: "omp-webhooks",
} as const;

/** Job names on the `omp:jobs` queue. */
export const JOB_NAMES = {
  /** Repeatable tick produced by a job scheduler; fans out to `run` jobs. */
  dispatch: "dispatch",
  /** A single processor invocation (one user, or one global run). */
  run: "run",
} as const;

/** Job names on the `omp:webhooks` queue. */
export const WEBHOOK_JOB_NAMES = {
  deliver: "deliver",
} as const;

export interface DispatchJobData {
  jobName: string;
}

export interface RunJobData {
  jobName: string;
  userId?: string;
  dateRange?: { from: string; to: string };
}

export interface WebhookDeliverJobData {
  webhookId: string;
  event: string;
  payload: unknown;
  attempt: number;
  retryOfLogId: string;
}

/**
 * Create a fresh ioredis connection configured for BullMQ. Producers and each
 * worker get their own; never reuse the shared `@/lib/redis` client.
 */
export function createQueueConnection(): IORedis {
  const conn = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  conn.on("error", (err) => logger.error({ err }, "BullMQ Redis connection error"));
  return conn;
}

// Cache queue producer instances (and their shared producer connection) on
// globalThis so Next.js dev HMR reuse a single connection instead of leaking.
const globalForQueue = globalThis as unknown as {
  __ompQueueConnection?: IORedis;
  __ompQueues?: Map<string, Queue>;
};

function producerConnection(): IORedis {
  if (!globalForQueue.__ompQueueConnection) {
    globalForQueue.__ompQueueConnection = createQueueConnection();
  }
  return globalForQueue.__ompQueueConnection;
}

function getQueue(name: string): Queue {
  if (!globalForQueue.__ompQueues) globalForQueue.__ompQueues = new Map();
  const existing = globalForQueue.__ompQueues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: producerConnection() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 24 * 3_600 },
    },
  });
  globalForQueue.__ompQueues.set(name, queue);
  return queue;
}

export function jobsQueue(): Queue {
  return getQueue(QUEUE_NAMES.jobs);
}

export function webhooksQueue(): Queue {
  return getQueue(QUEUE_NAMES.webhooks);
}

/**
 * Idempotency bucket for a firing: the app-timezone hour it fired in. All the
 * scheduled extensions fire at most once per hour (daily, weekly, or every
 * N hours), so `jobName + userId + bucket` uniquely identifies one intended
 * run — a double trigger within the same minute/hour dedupes to one job.
 */
export function firingBucket(date: Date = new Date()): string {
  const p = dateTimePartsInTimeZone(date);
  return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}${String(p.hour).padStart(2, "0")}`;
}

/**
 * Enqueue a single processor invocation with a deterministic, idempotent jobId.
 * A duplicate enqueue (double trigger, retry) with the same key is ignored by
 * BullMQ, so users can't be double-emailed.
 */
export async function enqueueRun(data: RunJobData, bucket: string): Promise<void> {
  const idParts = ["run", data.jobName, data.userId ?? "global", bucket];
  await jobsQueue().add(JOB_NAMES.run, data, { jobId: idParts.join(":") });
}

/**
 * Enqueue a dispatch tick for one extension (manual "run now"). Fans out to
 * per-user runs in the worker. Idempotent within the firing hour.
 */
export async function enqueueDispatch(jobName: string): Promise<void> {
  await jobsQueue().add(
    JOB_NAMES.dispatch,
    { jobName } satisfies DispatchJobData,
    { jobId: `dispatch:${jobName}:${firingBucket()}` },
  );
}

/**
 * Enqueue a webhook delivery attempt. `delayMs` schedules a retry; the
 * jobId keys on the log row + attempt so a re-enqueue of the same attempt is a
 * no-op.
 */
export async function enqueueWebhookDelivery(
  data: WebhookDeliverJobData,
  delayMs = 0,
): Promise<void> {
  await webhooksQueue().add(WEBHOOK_JOB_NAMES.deliver, data, {
    jobId: `wh:${data.webhookId}:${data.retryOfLogId}:${data.attempt}`,
    delay: delayMs > 0 ? delayMs : undefined,
    // Delivery attempts manage their own retry chain; don't let BullMQ retry.
    attempts: 1,
  });
}

/**
 * Register (idempotently) one repeatable job scheduler per scheduled extension,
 * firing on its manifest cron in APP_TIME_ZONE. Called on worker boot;
 * `upsertJobScheduler` updates in place rather than duplicating on restart.
 */
export async function registerSchedulers(): Promise<string[]> {
  const queue = jobsQueue();
  const registered: string[] = [];
  for (const ext of extensions) {
    const schedule = ext.processor?.schedule;
    const jobName = ext.processor?.jobName;
    if (!schedule || !jobName) continue;
    await queue.upsertJobScheduler(
      `sched:${jobName}`,
      { pattern: schedule, tz: APP_TIME_ZONE },
      { name: JOB_NAMES.dispatch, data: { jobName } satisfies DispatchJobData },
    );
    registered.push(jobName);
  }
  return registered;
}

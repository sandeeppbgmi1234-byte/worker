import { Worker, Job } from "bullmq";
import {
  processWebhookEvent,
  InstagramWebhookPayload,
} from "./lib/instagram/webhook/webhook-handler";
import { logger } from "./lib/utils/pino";

const REDIS_CONNECTION = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: 6379,
  username: process.env.UPSTASH_REDIS_USERNAME,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

// Some edge-cases -
// 1. What happens when access token expires mid processing.
// 2. What happens when users disconnect their accounts.

/**
 * Sets up and configures the BullMQ worker for Instagram webhooks
 * @returns {Worker} Confgured BullMQ worker instance
 */
export function setupWorker(): Worker {
  const worker = new Worker(
    "webhook-processing",
    async (job: Job) => {
      try {
        logger.info(
          {
            attempt: job.attemptsMade + 1,
            payload: job.data,
          },
          `Processing job ${job.id}`,
        );
        const payload = job.data as InstagramWebhookPayload;
        await processWebhookEvent(payload);
      } catch (err: any) {
        if (err?.status === 429) {
          // Instagram is rate limiting, need to wait longer before retrying
          await job.moveToDelayed(Date.now() + 60_000); // delay 1 minute
        }
        throw err; // other errors follow normal retry logic
      }
    },
    {
      connection: REDIS_CONNECTION,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || "10"),
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
      stalledInterval: 30_000, // check for stalled jobs every 30s
      maxStalledCount: 2, // move to failed after 2 stalled checks
    },
  );

  worker.on("completed", (job) => {
    logger.info(`Job with id ${job.id} has been completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job with id ${job?.id} has failed with ${err.message}`);
  });

  return worker;
}

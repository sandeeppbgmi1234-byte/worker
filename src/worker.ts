import { Worker, Job } from "bullmq";
import {
  processWebhookEvent,
  InstagramWebhookPayload,
} from "./lib/instagram/webhook/webhook-handler";
import { logger } from "./lib/utils/logger";

const REDIS_CONNECTION = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: 6379,
  username: process.env.UPSTASH_REDIS_USERNAME,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

/**
 * Sets up and configures the BullMQ worker for Instagram webhooks
 * @returns {Worker} Confgured BullMQ worker instance
 */
export function setupWorker(): Worker {
  const worker = new Worker(
    "webhook-processing",
    async (job: Job) => {
      logger.info(`Processing job ${job.id}`);
      const payload = job.data as InstagramWebhookPayload;
      await processWebhookEvent(payload);
    },
    {
      connection: REDIS_CONNECTION,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || "10"),
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
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

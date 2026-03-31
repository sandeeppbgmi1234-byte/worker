import { Worker } from "bullmq";
import { logger } from "../logger";
import { processWebhookJob } from "./processor";
import { WORKER_CONFIG } from "../config/worker.config";
import { QUEUE_CONNECTION } from "../config/redis.config";

export function setupWorker(): Worker {
  const worker = new Worker(WORKER_CONFIG.QUEUE_NAME, processWebhookJob, {
    connection: QUEUE_CONNECTION,
    concurrency: WORKER_CONFIG.CONCURRENCY,
    removeOnComplete: { count: WORKER_CONFIG.RETENTION.COMPLETED_COUNT },
    removeOnFail: { count: WORKER_CONFIG.RETENTION.FAILED_COUNT },
    stalledInterval: WORKER_CONFIG.STALLED.INTERVAL_MS,
    maxStalledCount: WORKER_CONFIG.STALLED.MAX_COUNT,
  });

  worker.on("completed", (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    if (err.message === "DelayedError") return;
    logger.error(`Job ${job?.id} failed ultimately: ${err.message}`);
  });

  return worker;
}

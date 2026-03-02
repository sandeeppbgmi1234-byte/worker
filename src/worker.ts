import { DelayedError, Worker, Job } from "bullmq";
import {
  processWebhookEvent,
  InstagramWebhookPayload,
} from "./lib/instagram/webhook/webhook-handler";
import { logger } from "./lib/utils/pino";
import {
  InstagramRateLimitError,
  InstagramTokenExpiredError,
  InstagramSpamPolicyError,
} from "./lib/instagram/api/api-errors";

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
      // 1. Create a child logger for full traceability of this specific job execution
      const jobLogger = logger.child({
        jobId: job.id,
        attempt: job.attemptsMade + 1,
      });
      jobLogger.info({ payload: job.data }, `Processing job ${job.id}`);

      try {
        const payload = job.data as InstagramWebhookPayload;
        await processWebhookEvent(payload);
      } catch (err: any) {
        // --- CENTRALIZED ERROR HANDLING ---

        // 1. Token Expired (Fatal)
        if (err instanceof InstagramTokenExpiredError) {
          jobLogger.warn("Instagram Token Expired permanently. Failing job.");
          // We rely on the specific flow to mark `dbAccount.isActive = false`
          // but we ensure the job dies here without retries.
          throw err;
        }

        // 2. Spam or Privacy Policy (Permanent Local Error)
        if (err instanceof InstagramSpamPolicyError) {
          jobLogger.warn(
            "Action restricted by Instagram Spam Policy. Failing job.",
          );
          throw err; // Fail without retry
        }

        // 3. Instagram Rate Limiting (Temporary)
        if (err instanceof InstagramRateLimitError) {
          jobLogger.warn(
            { isAppLevel: err.isAppLevel },
            `Instagram Rate Limit hit: ${err.message}. Delaying job.`,
          );
          // If it's the global limit, we tell BullMQ to put this job into the "delayed" set for a few minutes
          // Next time it comes back, we'll check Redis dynamically again mapping to `call_count`
          const delayMs = err.isAppLevel ? 5 * 60_000 : 10 * 60_000;
          await job.moveToDelayed(Date.now() + delayMs);
          throw new DelayedError();
        }

        // 4. Database Concurrency Constraints (Idempotency Race Conditions)
        if (err?.code === "P2002") {
          // Prisma Unique Constraint Violation
          // Two identical webhooks tried to insert an `AutomationExecution` record at the exact same millisecond.
          // Non fatal. One worker won, this worker lost. We can safely drop this job.
          jobLogger.info(
            "Duplicate automation execution prevented (DB constraint). Non fatal.",
          );
          return; // Returning safely completes the job as a no-op
        }

        // 5. Unknown Generic Error -> Bubble up for BullMQ backoff retry
        jobLogger.error(
          {
            type: err?.name || typeof err,
            message: err?.message || String(err),
          },
          "Unhandled error during webhook processing",
        );
        throw err;
      }
    },
    {
      connection: REDIS_CONNECTION,
      // CONCURRENCY IS STRICTLY 1 to serialize requests and read X-App-Usage headers safely
      concurrency: 1,
      // Dynamic Throttling: Starting with a conservative baseline to share the 1,000 call/hour budget with the frontend
      // In a production App, this limiter max/duration should be dynamically adjusted based on DAU.
      limiter: {
        max: 8, // 8 jobs
        duration: 60_000, // per 60 seconds
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
      stalledInterval: 30_000, // check for stalled jobs every 30s
      maxStalledCount: 2, // move to failed after 2 stalled checks
    },
  );

  worker.on("completed", (job) => {
    logger.debug(`Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    // If it was intentionally delayed, don't spam the error logs
    if (err.message === "DelayedError") return;
    logger.error(`Job ${job?.id} failed ultimately: ${err.message}`);
  });

  return worker;
}

/**
 * BullMQ Worker
 * Processes webhook jobs from the queue
 */

import { Worker } from "bullmq";
import { getRedisConnectionOptions } from "./db/redis.ts";
import { processWebhookEvent } from "./lib/instagram/webhook/webhook-handler.ts";

/**
 * Sets up and starts the webhook processing worker
 */
export function setupWorker() {
  const connectionOptions = getRedisConnectionOptions();

  const worker = new Worker(
    "webhook-processing",
    async (job) => {
      console.log(`📦 Processing webhook job ${job.id}`);

      try {
        // Uses local webhook handler
        await processWebhookEvent(job.data);

        console.log(`✅ Completed webhook job ${job.id}`);
      } catch (error) {
        console.error(`❌ Failed to process webhook job ${job.id}:`, error);
        // Logs the full error for debugging
        if (error instanceof Error) {
          console.error("Error details:", error.message);
          console.error("Stack:", error.stack);
        }
        throw error; // Re-throws to trigger retry logic
      }
    },
    {
      connection: connectionOptions,
      concurrency: 5, // Processes 5 jobs concurrently
      limiter: {
        max: 10,
        duration: 1000, // Max 10 jobs per second
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err);
  });

  worker.on("error", (err) => {
    console.error("❌ Worker error:", err);
  });

  worker.on("active", (job) => {
    console.log(`🔄 Job ${job.id} is now active`);
  });

  console.log("🚀 BullMQ worker started for 'webhook-processing' queue");

  // Handles graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("🛑 SIGTERM received, closing worker...");
    await worker.close();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("🛑 SIGINT received, closing worker...");
    await worker.close();
    process.exit(0);
  });

  return worker;
}

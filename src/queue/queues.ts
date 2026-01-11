/**
 * BullMQ Queue Definitions
 * Defines queues for worker job processing
 */

import { Queue } from "bullmq";
import { getRedisClient } from "./redis";

/**
 * Webhook processing queue
 * Same queue name as Next.js app uses
 */
export const webhookQueue = new Queue("webhook-processing", {
  connection: getRedisClient(),
});


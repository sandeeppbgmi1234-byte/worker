import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { QUEUE_CONNECTION } from "../config/redis.config";
import { KEYS } from "../redis/keys";
import { logger } from "../logger";

let notificationsQueue: Queue | null = null;

/**
 * Returns the singleton instance of the BullMQ Notifications Queue.
 */
export function getNotificationsQueue(): Queue {
  if (!notificationsQueue) {
    notificationsQueue = new Queue(KEYS.NOTIFICATIONS_QUEUE, {
      connection: QUEUE_CONNECTION,
      defaultJobOptions: {
        removeOnComplete: { age: 600 },
        removeOnFail: { age: 24 * 3600 }, // Keep failed for 24h

        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      },
    });
  }
  return notificationsQueue;
}

export type NotificationPayload = {
  type: "QUOTA_FULL";
  userId: string;
  usedAt: number;
};

/**
 * Pushes a notification job to the queue.
 * Idempotency is handled via jobId to prevent spamming the same notification.
 */
export async function addNotificationJob(payload: NotificationPayload) {
  const queue = getNotificationsQueue();
  try {
    const windowInMs = 10 * 60 * 1000; // 10 minute deduplication window
    const windowId = Math.floor(Date.now() / windowInMs);

    const hashedUserId = createHash("sha256")
      .update(payload.userId)
      .digest("hex")
      .substring(0, 10);

    const jobId = `quota_full-${hashedUserId}-${windowId}`;
    await queue.add(payload.type, payload, {
      jobId,
    });
    logger.info({ hashedUserId, jobId }, "Notification job added to queue");
  } catch (err: any) {
    const hashedUserId = createHash("sha256")
      .update(payload.userId)
      .digest("hex")
      .substring(0, 10);
    logger.error(
      { hashedUserId, err: err.message },
      "Failed to add notification job to queue",
    );
  }
}

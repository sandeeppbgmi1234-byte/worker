import { Queue } from "bullmq";
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
        removeOnComplete: true,
        removeOnFail: 1000,
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

    await queue.add(payload.type, payload, {
      jobId: `quota_full:${payload.userId}:${windowId}`,
    });
  } catch (err: any) {
    logger.error(
      { userId: payload.userId, err: err.message },
      "Failed to add notification job to queue",
    );
  }
}

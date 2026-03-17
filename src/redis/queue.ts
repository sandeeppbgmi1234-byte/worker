import { Redis } from "ioredis";
import { logger } from "../logger";
import { QUEUE_CONNECTION } from "../config/redis.config";

let queueClient: Redis | null = null;

/**
 * Returns the Dedicated Queue Redis instance (for BullMQ).
 * Strictly mandatory for the worker to operate.
 */
export function getQueueRedisClient(): Redis {
  if (!queueClient) {
    if (!QUEUE_CONNECTION.host || !QUEUE_CONNECTION.password) {
      throw new Error(
        "QUEUE_REDIS_HOST or QUEUE_REDIS_PASSWORD is missing. Worker cannot start.",
      );
    }

    queueClient = new Redis({
      ...QUEUE_CONNECTION,
      maxRetriesPerRequest: null, // Critical requirement for BullMQ
      retryStrategy(times) {
        if (times > 10) {
          logger.error("Queue Redis connection failed. Retrying slowly.");
          return 5000;
        }
        return Math.min(times * 1000, 2000);
      },
    });

    queueClient.on("error", (err) => {
      logger.error({ err }, "Queue Redis Error");
    });
  }
  return queueClient;
}

import { Redis } from "ioredis";
import { logger } from "../utils/pino";

// Lazy-initialize Redis only if needed to avoid startup crashes if env is missing
let redisClient: Redis | null = null;

/**
 * Returns the Upstash Redis singleton instance.
 * If the connection cannot be established or strict env vars are missing,
 * it returns null. The entire Redis module is designed to fall back gracefully to MongoDB
 * if this returns null.
 */
export function getRedisClient(): Redis | null {
  if (!redisClient) {
    if (
      process.env.UPSTASH_REDIS_HOST &&
      process.env.UPSTASH_REDIS_USERNAME &&
      process.env.UPSTASH_REDIS_PASSWORD
    ) {
      redisClient = new Redis({
        host: process.env.UPSTASH_REDIS_HOST,
        port: 6379,
        username: process.env.UPSTASH_REDIS_USERNAME,
        password: process.env.UPSTASH_REDIS_PASSWORD,
        tls: {},
        // If Redis goes down, fail fast rather than hanging the worker processes
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        retryStrategy(times) {
          // Reconnect strategy. Stop retrying after 3 attempts so it falls back to DB
          if (times > 3) {
            logger.error(
              "Redis connection failed. Halting retries and falling back to MongoDB.",
            );
            return null; // Stop retrying
          }
          return Math.min(times * 100, 2000); // Backoff: 100ms, 200ms, 300ms... max 2s
        },
      });

      redisClient.on("error", (err) => {
        logger.error({ err }, "Redis Client Error");
      });
    } else {
      logger.warn(
        "Redis disabled: Missing UPSTASH_REDIS_HOST, UPSTASH_REDIS_USERNAME or UPSTASH_REDIS_PASSWORD",
      );
    }
  }
  return redisClient;
}

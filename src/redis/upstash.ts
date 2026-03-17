import { Redis } from "ioredis";
import { logger } from "../logger";
import { REDIS_CONNECTION } from "../config/redis.config";

let upstashClient: Redis | null = null;

/**
 * Returns the Upstash Redis instance (for caching).
 * Fails gracefully (returns null) if credentials are missing to allow DB fallback.
 */
export function getUpstashClient(): Redis | null {
  if (!upstashClient) {
    if (REDIS_CONNECTION.host && REDIS_CONNECTION.password) {
      upstashClient = new Redis({
        ...REDIS_CONNECTION,
        retryStrategy(times) {
          if (times > 3) {
            logger.error("Upstash Redis connection failed after 3 attempts.");
            return null;
          }
          return Math.min(times * 100, 2000);
        },
      });

      upstashClient.on("error", (err) => {
        logger.error({ err }, "Upstash Redis Error");
      });
    } else {
      logger.warn(
        "Upstash Redis disabled: Missing UPSTASH_REDIS_HOST or UPSTASH_REDIS_PASSWORD",
      );
    }
  }
  return upstashClient;
}

// Alias for general usage
export const getRedisClient = getUpstashClient;

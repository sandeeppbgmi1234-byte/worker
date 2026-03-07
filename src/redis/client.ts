import { Redis } from "ioredis";
import { logger } from "../logger";
import { REDIS_CONNECTION } from "../config/redis.config";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!redisClient) {
    if (
      REDIS_CONNECTION.host &&
      REDIS_CONNECTION.username &&
      REDIS_CONNECTION.password
    ) {
      redisClient = new Redis({
        ...REDIS_CONNECTION,
        retryStrategy(times) {
          if (times > 3) {
            logger.error(
              "Redis connection failed. Halting retries and falling back to MongoDB.",
            );
            return null;
          }
          return Math.min(times * 100, 2000);
        },
      });

      redisClient.on("error", (err) => {
        logger.error({ err }, "Redis Client Error");
      });
    } else {
      logger.warn("Redis disabled: Missing credentials");
    }
  }
  return redisClient;
}

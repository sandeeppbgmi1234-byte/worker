/**
 * Redis Connection
 * Singleton Redis client for worker queue operations
 */

import Redis from "ioredis";
import type { ConnectionOptions } from "bullmq";

let redisClient: Redis | null = null;

/**
 * Gets Redis connection options for BullMQ
 * Returns connection string (BullMQ accepts connection string)
 */
export function getRedisConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  // BullMQ accepts connection string as ConnectionOptions
  return redisUrl as ConnectionOptions;
}

/**
 * Gets or creates Redis connection
 */
export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    reconnectOnError: (err) => {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
  });

  redisClient.on("connect", () => {
    console.log("✅ Redis client connected");
  });

  redisClient.on("error", (err) => {
    console.error("❌ Redis client error:", err);
  });

  redisClient.on("close", () => {
    console.log("🔌 Redis client connection closed");
  });

  return redisClient;
}

/**
 * Closes Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

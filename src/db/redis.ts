/**
 * Redis Connection
 * Singleton Redis client for direct Redis operations
 */

import Redis from "ioredis";
import { logger } from "../lib/utils/logger";
import type { ConnectionOptions } from "bullmq";

let redisClient: Redis | null = null;

/**
 * Gets or creates Redis connection
 */
export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis({
    host: process.env.UPSTASH_REDIS_HOST,
    port: 6379,
    username: process.env.UPSTASH_REDIS_USERNAME,
    password: process.env.UPSTASH_REDIS_PASSWORD,
    tls: {},
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
    logger.info("Redis client connected");
  });

  redisClient.on("error", (err) => {
    logger.error("Redis client error", err);
  });

  redisClient.on("close", () => {
    logger.info("Redis client connection closed");
  });

  return redisClient;
}

/**
 * Gets Redis connection options for BullMQ
 */
export function getRedisConnectionOptions(): ConnectionOptions {
  return {
    host: process.env.UPSTASH_REDIS_HOST,
    port: 6379,
    username: process.env.UPSTASH_REDIS_USERNAME,
    password: process.env.UPSTASH_REDIS_PASSWORD,
    tls: {},
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

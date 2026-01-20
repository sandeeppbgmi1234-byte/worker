/**
 * Redis Connection
 * Provides Redis connection options for BullMQ
 */

import type { ConnectionOptions } from "bullmq";

/**
 * Gets Redis connection options for BullMQ
 * Returns connection object with explicit TLS settings for Upstash
 */
export function getRedisConnectionOptions(): ConnectionOptions {
  return {
    host: process.env.UPSTASH_REDIS_HOST,
    port: 6379,
    username: process.env.UPSTASH_REDIS_USERNAME,
    password: process.env.UPSTASH_REDIS_PASSWORD,
    tls: {}, // Enables TLS for Upstash
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

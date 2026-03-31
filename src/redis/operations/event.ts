import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";

/**
 * Checks if a webhook event ID has already been permanently handled.
 */
export async function isEventHandledR(eventId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.GLOBAL_EVENT_PROCESSED(eventId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.error({ eventId, error }, "Redis error checking handled event:");
    return false;
  }
}

/**
 * Acquires a short-term lock on a webhook event ID to prevent parallel processing.
 * Hard-coded to 10 minutes; if the server crashes, the lock will expire allowing retry.
 * @returns true if the lock was successfully acquired, false if it already exists or on error.
 */
export async function acquireEventLockR(eventId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = `lock:event:${eventId}`;

  try {
    const result = await redis.set(key, "1", "EX", 600, "NX");
    // If result is "OK", the lock was acquired
    return result === "OK";
  } catch (error: any) {
    logger.warn({ eventId, error }, "Redis error acquiring event lock:");
    return false;
  }
}

/**
 * Marks a webhook event ID as permanently handled (24 hours).
 */
export async function setEventHandledR(eventId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.GLOBAL_EVENT_PROCESSED(eventId);

  try {
    await redis.set(key, "1", "EX", TTL.COMMENT_PROCESSED);
  } catch (error: any) {
    logger.warn({ eventId, error }, "Redis error marking event as handled:");
  }
}

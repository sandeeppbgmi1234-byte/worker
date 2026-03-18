import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";

/**
 * Checks if a webhook event ID has already been handled by the system.
 * Uses Redis SET NX to handle both atomicity and deduplication in one call.
 */
export async function isEventHandledR(eventId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.GLOBAL_EVENT_PROCESSED(eventId);

  try {
    const result = await redis.set(key, "1", "EX", TTL.COMMENT_PROCESSED, "NX");
    // If result is null, it means the key already existed (NX condition failed)
    return result === null;
  } catch (error: any) {
    logger.error({ eventId, error }, "Redis error checking handled event:");
    return false;
  }
}

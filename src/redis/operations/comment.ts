import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";

/**
 * Performs an atomic check-and-mark for comment idempotency.
 * uses Redis SET ... NX ... EX to ensure only one thread successfully marks a comment as processed.
 *
 * @returns true when the call successfully marks the comment as processed/first time,
 *          false when the key already existed (already processed) or on Redis error.
 * @sideeffects Sets a Redis key with TTL.COMMENT_PROCESSED upon success.
 */
export async function isCommentProcessedR(
  webhookUserId: string,
  commentId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = KEYS.COMMENT_PROCESSED(webhookUserId, commentId, automationId);

  if (!redis) return false;

  try {
    const result = await redis.set(key, "1", "EX", TTL.COMMENT_PROCESSED, "NX");
    // If result is "OK", it's the first time we set it.
    // If result is null, it already existed.
    return result === "OK";
  } catch (error: any) {
    return false;
  }
}

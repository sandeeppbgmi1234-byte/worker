import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";

/**
 * Checks if a comment has already been processed for a specific automation (Idempotency).
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
    return result === null;
  } catch (error: any) {
    return false;
  }
}

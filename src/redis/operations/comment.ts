import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";

export async function isCommentProcessedR(
  commentId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = KEYS.COMMENT_PROCESSED(commentId, automationId);

  if (!redis) return false;

  try {
    const result = await redis.set(key, "1", "EX", TTL.COMMENT_PROCESSED, "NX");
    return result === null;
  } catch (error: any) {
    return false;
  }
}

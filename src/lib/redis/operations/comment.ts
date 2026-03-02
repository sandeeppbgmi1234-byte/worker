import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../utils/pino";

/**
 * Domain: Comment Processing (Idempotency Locks)
 * Critical for preventing duplicate DMs to exactly the same comment.
 */

/**
 * Atomically marks a comment as processed.
 * Uses Redis `SET NX` (Set if Not eXists).
 *
 * @returns true if we successfully acquired the lock (comment is NEW and we should process it)
 * @returns false if the comment was ALREADY processed (we should skip it)
 */
export async function isCommentProcessed(
  commentId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = KEYS.COMMENT_PROCESSED(commentId, automationId);

  // If Redis is down, we must fall-open (return false) so the worker falls back
  // to querying MongoDB natively in the handler rather than blocking all execution.
  if (!redis) {
    logger.warn(
      { commentId, automationId },
      "[Redis:Comment] Client down, falling open to DB",
    );
    return false; // Tells caller: "I couldn't verify in cache, you must check DB natively"
  }

  try {
    // SET NX = Only set the key if it does not already exist.
    // Returns 1 if set (meaning it was new), 0 if it already existed.
    const result = await redis.set(key, "1", "EX", TTL.COMMENT_PROCESSED, "NX");

    const wasAlreadyProcessed = result === null;

    if (wasAlreadyProcessed) {
      logger.info(
        { commentId, automationId },
        "[Redis:Comment] Lock rejected (already processed)",
      );
      return true; // Yes, it IS already processed. Abort operation.
    }

    logger.info(
      { commentId, automationId },
      "[Redis:Comment] Lock acquired (new comment)",
    );
    return false; // No, it is NOT processed yet. Proceed.
  } catch (error: any) {
    logger.error(
      { commentId, automationId, error: error.message },
      "[Redis:Comment] Lock check failed, falling open to DB",
    );
    // On failure, fall open so we can rely on DB constraint checks native to worker.ts
    return false;
  }
}

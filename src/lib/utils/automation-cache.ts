/**
 * Automation Cache Utilities
 * Handles cache invalidation for automation existence checks
 * and caching for processed comment checks
 */

import { getRedisClient } from "../../db/redis";

const redis = getRedisClient();

/**
 * Invalidates the automation existence cache for a specific user (by Clerk ID) and post
 * This ensures webhooks will re-check for automations after creation/update/deletion
 */
export async function invalidateAutomationCache(
  clerkId: string,
  postId: string
): Promise<void> {
  const cacheKey = `ig:automation:${clerkId}:${postId}`;
  await redis.del(cacheKey);
}

/**
 * Checks if a comment was already processed (with caching)
 * Uses cache to avoid DB lookups for already-processed comments
 */
export async function isCommentProcessedCached(
  commentId: string,
  automationId: string,
  dbCheck: () => Promise<boolean>
): Promise<boolean> {
  const cacheKey = `ig:processed:${commentId}:${automationId}`;

  // Checks cache first
  const cached = await redis.get(cacheKey);
  if (cached === "1") {
    return true; // Already processed
  }

  // Cache miss - checks DB
  const processed = await dbCheck();

  // Caches the result
  // If processed: cache for 24 hours (immutable, won't change)
  // If not processed: cache for 2 minutes (might become processed soon)
  await redis.set(
    cacheKey,
    processed ? "1" : "0",
    "EX",
    processed ? 24 * 60 * 60 : 2 * 60
  );

  return processed;
}

/**
 * Marks a comment as processed in cache
 * Called after successful automation execution
 */
export async function markCommentProcessed(
  commentId: string,
  automationId: string
): Promise<void> {
  const cacheKey = `ig:processed:${commentId}:${automationId}`;
  // Caches for 24 hours since this is immutable
  await redis.set(cacheKey, "1", "EX", 24 * 60 * 60);
}

/**
 * Clears all cache related to an Instagram account and user
 * Called when user disconnects their Instagram account
 */
export async function clearAllUserCache(
  webhookUserId: string,
  clerkId: string
): Promise<void> {
  const pipeline = redis.pipeline();

  // Deletes account webhook cache (uses webhookUserId from webhook payload)
  pipeline.del(`ig:webhook:${webhookUserId}`);

  // Deletes all automation existence caches for this user
  // Uses SCAN to find all keys matching the pattern
  const automationPattern = `ig:automation:${clerkId}:*`;
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      automationPattern,
      "COUNT",
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      pipeline.del(...keys);
    }
  } while (cursor !== "0");

  // Deletes status cache for this user
  pipeline.del(`ig:account:${clerkId}`);

  // Executes all deletions
  await pipeline.exec();
}

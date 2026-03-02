import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../utils/pino";
import type { Automation } from "@prisma/client";

/**
 * Domain: Automations
 * Caches the active automation rules and dbAccount object to prevent PostgreSQL hammering
 * during burst comments.
 */

// We cache automations for 24 hours. They are actively invalidated by Next.js on C/U/D.
const AUTOMATION_TTL = 24 * 60 * 60;

/**
 * Fetches the internal database account from Redis or falls back to MongoDB.
 *
 * @param instagramUserId User ID from Instagram
 * @param dbFallback The fallback function to query MongoDB if Redis misses
 */
export async function getAccountByInstagramId<T>(
  instagramUserId: string,
  dbFallback: () => Promise<T | null>,
): Promise<T | null> {
  const redis = getRedisClient();
  const key = KEYS.ACCOUNT_BY_IG(instagramUserId);

  if (!redis) {
    logger.info(
      { instagramUserId },
      "[Redis:Account] Client down, falling back natively",
    );
    return dbFallback();
  }

  try {
    const cached = await redis.get(key);
    if (cached) {
      logger.info(
        { instagramUserId, hit: true },
        "[Redis:Account] DB Account retrieved from cache",
      );
      return JSON.parse(cached);
    }

    logger.info(
      { instagramUserId, hit: false },
      "[Redis:Account] Account missing, falling back natively",
    );
    const account = await dbFallback();

    if (account) {
      // Fire and forget caching
      redis
        .set(key, JSON.stringify(account), "EX", AUTOMATION_TTL)
        .catch((e) => {
          logger.warn(
            { instagramUserId, error: e.message },
            "[Redis:Account] Failed to cache account",
          );
        });
    }

    return account;
  } catch (error: any) {
    logger.error(
      { instagramUserId, error: error.message },
      "[Redis:Account] Operation failed, falling back natively",
    );
    return dbFallback();
  }
}

/**
 * Fetches the active automations for a specific post from Redis or falls back to MongoDB.
 */
export async function getAutomationsByPost(
  userId: string,
  mediaId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_BY_POST(userId, mediaId);

  if (!redis) {
    logger.info(
      { userId, mediaId },
      "[Redis:Automation] Client down, falling back natively",
    );
    return dbFallback();
  }

  try {
    const cached = await redis.get(key);
    if (cached) {
      logger.info(
        { userId, mediaId, hit: true },
        "[Redis:Automation] Post Automations retrieved from cache",
      );
      return JSON.parse(cached);
    }

    logger.info(
      { userId, mediaId, hit: false },
      "[Redis:Automation] Post Automations missing, falling back natively",
    );
    const automations = await dbFallback();

    redis
      .set(key, JSON.stringify(automations), "EX", AUTOMATION_TTL)
      .catch((e) => {
        logger.warn(
          { userId, mediaId, error: e.message },
          "[Redis:Automation] Failed to cache Post Automations",
        );
      });

    return automations;
  } catch (error: any) {
    logger.error(
      { userId, mediaId, error: error.message },
      "[Redis:Automation] Operation failed, falling back natively",
    );
    return dbFallback();
  }
}

/**
 * Fetches the active automations for a specific story from Redis or falls back to MongoDB.
 */
export async function getAutomationsByStory(
  userId: string,
  storyId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_BY_STORY(userId, storyId);

  if (!redis) {
    logger.info(
      { userId, storyId },
      "[Redis:Automation] Client down, falling back natively",
    );
    return dbFallback();
  }

  try {
    const cached = await redis.get(key);
    if (cached) {
      logger.info(
        { userId, storyId, hit: true },
        "[Redis:Automation] Story Automations retrieved from cache",
      );
      return JSON.parse(cached);
    }

    logger.info(
      { userId, storyId, hit: false },
      "[Redis:Automation] Story Automations missing, falling back natively",
    );
    const automations = await dbFallback();

    redis
      .set(key, JSON.stringify(automations), "EX", AUTOMATION_TTL)
      .catch((e) => {
        logger.warn(
          { userId, storyId, error: e.message },
          "[Redis:Automation] Failed to cache Story Automations",
        );
      });

    return automations;
  } catch (error: any) {
    logger.error(
      { userId, storyId, error: error.message },
      "[Redis:Automation] Operation failed, falling back natively",
    );
    return dbFallback();
  }
}

/**
 * Atomically clears all automation and account caches for a user.
 * Invoked by Next.js when automations or accounts are changed.
 */
export async function invalidateAutomations(userId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();

    // Use SCAN to find all Post and Story automation caches
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `ig:automations_*:${userId}:*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        pipeline.del(...keys);
      }
    } while (cursor !== "0");

    await pipeline.exec();
    logger.info(
      { userId },
      "[Redis:Automation] Invalidation completed successfully",
    );
  } catch (error: any) {
    logger.error(
      { userId, error: error.message },
      "[Redis:Automation] Failed to invalidate cache",
    );
  }
}

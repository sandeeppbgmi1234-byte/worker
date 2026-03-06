import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../utils/pino";

/**
 * Domain: Cooldowns
 * Answers: "Has this specific Instagram User been hit by this specific automation recently?"
 */

/**
 * Atomically attempts to place a user on cooldown for a specific automation.
 *
 * @param instagramUserId The external user ID interacting with the post
 * @param automationId The id of the triggered automation
 * @param customTtlSeconds Optional custom cooldown in seconds
 * @returns true if they are ALREADY on cooldown (skip job)
 * @returns false if they were NOT on cooldown (lock acquired, proceed)
 */
export async function isUserOnCooldown(
  instagramUserId: string,
  automationId: string,
  customTtlSeconds?: number,
): Promise<boolean> {
  return false;
  // const redis = getRedisClient();
  // const key = KEYS.USER_COOLDOWN(instagramUserId, automationId);

  // if (!redis) {
  //   logger.warn(
  //     { instagramUserId, automationId },
  //     "[Redis:Cooldown] Client down, falling open",
  //   );
  //   return false; // Fall open so we don't block logic if cache dies
  // }

  // try {
  //   const ttl =
  //     customTtlSeconds && customTtlSeconds > 0
  //       ? customTtlSeconds
  //       : TTL.DEFAULT_COOLDOWN;

  //   // SET NX atomically acquires lock — returns null if key already exists
  //   const result = await redis.set(key, "1", "EX", ttl, "NX");

  //   const isAlreadyOnCooldown = result === null;

  //   if (isAlreadyOnCooldown) {
  //     logger.info(
  //       { instagramUserId, automationId },
  //       "[Redis:Cooldown] Lock rejected (user already on cooldown)",
  //     );
  //     return true; // Abort processing
  //   }

  //   logger.info(
  //     { instagramUserId, automationId, ttl },
  //     "[Redis:Cooldown] Lock acquired (user placed on cooldown)",
  //   );
  //   return false; // Proceed
  // } catch (error: any) {
  //   logger.error(
  //     { instagramUserId, automationId, error: error.message },
  //     "[Redis:Cooldown] Check failed, falling open",
  //   );
  //   return false;
  // }
}

/**
 * Removes a user cooldown lock.
 * Used when an execution results in a non-final state (like Ask to Follow).
 */
export async function clearUserCooldown(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  const key = KEYS.USER_COOLDOWN(instagramUserId, automationId);

  if (!redis) return;

  try {
    await redis.del(key);
    logger.info(
      { instagramUserId, automationId },
      "[Redis:Cooldown] Lock manually cleared",
    );
  } catch (error: any) {
    logger.error(
      { instagramUserId, automationId, error: error.message },
      "[Redis:Cooldown] Failed to clear lock",
    );
  }
}

import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";

export async function isUserThrottledR(
  instagramUserId: string,
  automationId: string,
  timeoutSeconds = 10,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const key = KEYS.USER_THROTTLE(instagramUserId, automationId);

  try {
    const result = await redis.set(key, "1", "EX", timeoutSeconds, "NX");
    return result === null;
  } catch (error: any) {
    logger.debug({ error, key }, `isUserThrottledR failed for key=${key}`);
    return true;
  }
}

export async function isEventThrottledR(
  eventId: string,
  timeoutSeconds = 10,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const key = KEYS.EVENT_THROTTLE(eventId);

  try {
    const result = await redis.set(key, "1", "EX", timeoutSeconds, "NX");
    return result === null;
  } catch (error: any) {
    logger.debug({ error, key }, `isEventThrottledR failed for key=${key}`);
    return true;
  }
}

export async function isUserOnCooldownR(
  instagramUserId: string,
  automationId: string,
): Promise<boolean> {
  // Configured check for production cooldowns
  if (process.env.ENABLE_USER_COOLDOWN !== "true") {
    return false;
  }

  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.USER_COOLDOWN(instagramUserId, automationId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isUserOnCooldownR failed for key=${key}`);
    return false;
  }
}

export async function setUserCooldownR(
  instagramUserId: string,
  automationId: string,
  customTtlSeconds?: number,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.USER_COOLDOWN(instagramUserId, automationId);
  const ttl = customTtlSeconds ?? TTL.DEFAULT_COOLDOWN;

  try {
    await redis.set(key, "1", "EX", ttl);
  } catch (error: any) {
    logger.warn({ error, key }, `setUserCooldownR failed for key=${key}`);
  }
}

export async function isPendingConfirmationR(
  instagramUserId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.PENDING_CONFIRMATION(instagramUserId, automationId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isPendingConfirmationR failed for key=${key}`);
    return false;
  }
}

export async function setPendingConfirmationR(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.PENDING_CONFIRMATION(instagramUserId, automationId);
  const ttl = TTL.PENDING_CONFIRMATION;

  try {
    await redis.set(key, "1", "EX", ttl);
  } catch (error: any) {
    logger.warn(
      { error, key },
      `setPendingConfirmationR failed for key=${key}`,
    );
  }
}

export async function clearPendingConfirmationR(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.PENDING_CONFIRMATION(instagramUserId, automationId);

  try {
    await redis.del(key);
  } catch (error: any) {
    logger.warn(
      { error, key },
      `clearPendingConfirmationR failed for key=${key}`,
    );
  }
}

export async function isAskResolvedR(
  instagramUserId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.ASK_RESOLVED(instagramUserId, automationId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isAskResolvedR failed for key=${key}`);
    return false;
  }
}

export async function setAskResolvedR(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.ASK_RESOLVED(instagramUserId, automationId);

  try {
    await redis.set(key, "1", "EX", TTL.ASK_RESOLVED);
  } catch (error: any) {
    logger.warn({ error, key }, `setAskResolvedR failed for key=${key}`);
  }
}

export async function clearAskResolvedR(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.ASK_RESOLVED(instagramUserId, automationId);

  try {
    await redis.del(key);
  } catch (error: any) {
    logger.warn({ error, key }, `clearAskResolvedR failed for key=${key}`);
  }
}

export async function clearUserCooldownR(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  const key = KEYS.USER_COOLDOWN(instagramUserId, automationId);

  if (!redis) return;

  try {
    await redis.del(key);
  } catch (error: any) {
    logger.warn({ error, key }, `clearUserCooldownR failed for key=${key}`);
  }
}

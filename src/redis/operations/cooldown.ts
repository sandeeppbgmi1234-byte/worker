import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";

export async function isUserThrottledR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
  timeoutSeconds = 10,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const key = KEYS.USER_THROTTLE(webhookUserId, followerId, automationId);

  try {
    const result = await redis.set(key, "1", "EX", timeoutSeconds, "NX");
    return result === null;
  } catch (error: any) {
    logger.debug({ error, key }, `isUserThrottledR failed for key=${key}`);
    return true;
  }
}

export async function isEventThrottledR(
  webhookUserId: string,
  eventId: string,
  timeoutSeconds = 10,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const key = KEYS.EVENT_THROTTLE(webhookUserId, eventId);

  try {
    const result = await redis.set(key, "1", "EX", timeoutSeconds, "NX");
    return result === null;
  } catch (error: any) {
    logger.debug({ error, key }, `isEventThrottledR failed for key=${key}`);
    return true;
  }
}

export async function isUserOnCooldownR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<boolean> {
  if (process.env.ENABLE_USER_COOLDOWN !== "true") return false;

  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.USER_COOLDOWN(webhookUserId, followerId, automationId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isUserOnCooldownR failed for key=${key}`);
    return false;
  }
}

export async function setUserCooldownR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
  customTtlSeconds?: number,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.USER_COOLDOWN(webhookUserId, followerId, automationId);
  const ttl = customTtlSeconds ?? TTL.DEFAULT_COOLDOWN;

  try {
    await redis.set(key, "1", "EX", ttl);
  } catch (error: any) {
    logger.warn({ error, key }, `setUserCooldownR failed for key=${key}`);
  }
}

export async function isPendingConfirmationR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.PENDING_CONFIRMATION(
    webhookUserId,
    followerId,
    automationId,
  );

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isPendingConfirmationR failed for key=${key}`);
    return false;
  }
}

export async function setPendingConfirmationR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.PENDING_CONFIRMATION(
    webhookUserId,
    followerId,
    automationId,
  );
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
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.PENDING_CONFIRMATION(
    webhookUserId,
    followerId,
    automationId,
  );

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
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.ASK_RESOLVED(webhookUserId, followerId, automationId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isAskResolvedR failed for key=${key}`);
    return false;
  }
}

export async function setAskResolvedR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.ASK_RESOLVED(webhookUserId, followerId, automationId);

  try {
    await redis.set(key, "1", "EX", TTL.ASK_RESOLVED);
  } catch (error: any) {
    logger.warn({ error, key }, `setAskResolvedR failed for key=${key}`);
  }
}

export async function clearAskResolvedR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.ASK_RESOLVED(webhookUserId, followerId, automationId);

  try {
    await redis.del(key);
  } catch (error: any) {
    logger.warn({ error, key }, `clearAskResolvedR failed for key=${key}`);
  }
}

export async function clearUserCooldownR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  const key = KEYS.USER_COOLDOWN(webhookUserId, followerId, automationId);

  if (!redis) return;

  try {
    await redis.del(key);
  } catch (error: any) {
    logger.warn({ error, key }, `clearUserCooldownR failed for key=${key}`);
  }
}

export async function isFollowWarningSentR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const key = KEYS.FOLLOW_WARNING(webhookUserId, followerId, automationId);

  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isFollowWarningSentR failed for key=${key}`);
    return false;
  }
}

export async function setFollowWarningSentR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.FOLLOW_WARNING(webhookUserId, followerId, automationId);

  try {
    await redis.set(key, "1", "EX", TTL.FOLLOW_WARNING);
  } catch (error: any) {
    logger.warn({ error, key }, `setFollowWarningSentR failed for key=${key}`);
  }
}
export async function isAccountSpamGuardedR(
  webhookUserId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;
  const key = KEYS.ACCOUNT_SPAM_GUARD(webhookUserId);
  try {
    const exists = await redis.exists(key);
    return exists > 0;
  } catch (error: any) {
    logger.warn({ error, key }, `isAccountSpamGuardedR failed for key=${key}`);
    return false;
  }
}

export async function setAccountSpamGuardR(
  webhookUserId: string,
  ttlSeconds: number = 2,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const key = KEYS.ACCOUNT_SPAM_GUARD(webhookUserId);
  try {
    await redis.set(key, "1", "EX", ttlSeconds);
  } catch (error: any) {
    logger.warn({ error, key }, `setAccountSpamGuardR failed for key=${key}`);
  }
}

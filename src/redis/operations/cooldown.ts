import { createHash } from "node:crypto";
import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";

/**
 * Redacts dynamic portions of a Redis key for safe logging.
 */
function redactKey(key: string): string {
  const parts = key.split(":");
  if (parts.length < 3) return key;

  const namespace = parts.slice(0, 2).join(":"); // e.g. "ig:throttle"
  const payload = parts.slice(2).join(":");
  const hash = createHash("sha256")
    .update(payload)
    .digest("hex")
    .substring(0, 8);
  return `${namespace}:[redacted:${hash}]`;
}

/**
 * Atomically acquires a flag in Redis using SET ... NX.
 */
async function acquireFlagR(key: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (error: any) {
    logger.debug(
      { error, key: redactKey(key) },
      `acquireFlagR failed for ${redactKey(key)}`,
    );
    return false;
  }
}

export async function isUserThrottledR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
  timeoutSeconds = 10,
): Promise<boolean> {
  const key = KEYS.USER_THROTTLE(webhookUserId, followerId, automationId);
  const acquired = await acquireFlagR(key, timeoutSeconds);
  return !acquired; // Throttled if NOT acquired
}

export async function isEventThrottledR(
  webhookUserId: string,
  eventId: string,
  timeoutSeconds = 10,
): Promise<boolean> {
  const key = KEYS.EVENT_THROTTLE(webhookUserId, eventId);
  const acquired = await acquireFlagR(key, timeoutSeconds);
  return !acquired; // Throttled if NOT acquired
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
    logger.warn(
      { error, key: redactKey(key) },
      `isUserOnCooldownR failed for key=${redactKey(key)}`,
    );
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
    logger.warn(
      { error, key: redactKey(key) },
      `setUserCooldownR failed for key=${redactKey(key)}`,
    );
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
    logger.warn(
      { error, key: redactKey(key) },
      `isPendingConfirmationR failed for key=${redactKey(key)}`,
    );
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
      { error, key: redactKey(key) },
      `setPendingConfirmationR failed for key=${redactKey(key)}`,
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
      { error, key: redactKey(key) },
      `clearPendingConfirmationR failed for key=${redactKey(key)}`,
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
    logger.warn(
      { error, key: redactKey(key) },
      `isAskResolvedR failed for key=${redactKey(key)}`,
    );
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
    logger.warn(
      { error, key: redactKey(key) },
      `setAskResolvedR failed for key=${redactKey(key)}`,
    );
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
    logger.warn(
      { error, key: redactKey(key) },
      `clearAskResolvedR failed for key=${redactKey(key)}`,
    );
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
    logger.warn(
      { error, key: redactKey(key) },
      `clearUserCooldownR failed for key=${redactKey(key)}`,
    );
  }
}

/**
 * Atomically acquires the follow warning flag.
 * Returns true if the flag was acquired (i.e., warning NOT already sent), false otherwise.
 */
export async function acquireFollowWarningFlagR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<boolean> {
  const key = KEYS.FOLLOW_WARNING(webhookUserId, followerId, automationId);
  return acquireFlagR(key, TTL.FOLLOW_WARNING);
}

// Deprecated in favor of acquireFollowWarningFlagR
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
    return false;
  }
}

// Deprecated in favor of acquireFollowWarningFlagR
export async function setFollowWarningSentR(
  webhookUserId: string,
  followerId: string,
  automationId: string,
): Promise<void> {
  const key = KEYS.FOLLOW_WARNING(webhookUserId, followerId, automationId);
  await acquireFlagR(key, TTL.FOLLOW_WARNING);
}

/**
 * Atomically acquires the account spam guard.
 * Returns true if the guard was acquired (i.e., spam guard NOT active), false otherwise.
 */
export async function acquireAccountSpamGuardR(
  webhookUserId: string,
  ttlSeconds: number = 2,
): Promise<boolean> {
  const key = KEYS.ACCOUNT_SPAM_GUARD(webhookUserId);
  return acquireFlagR(key, ttlSeconds);
}

// Deprecated for internal use, kept for compatibility if needed
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
    return false;
  }
}

export async function setAccountSpamGuardR(
  webhookUserId: string,
  ttlSeconds: number = 2,
): Promise<void> {
  const key = KEYS.ACCOUNT_SPAM_GUARD(webhookUserId);
  await acquireFlagR(key, ttlSeconds);
}

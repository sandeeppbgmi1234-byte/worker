import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import type { Automation } from "@prisma/client";

/**
 * Fetches automations matched by post (mediaId) from Redis.
 * Scoped by webhookUserId for strict account isolation.
 */
export async function getAutomationsByPostR(
  webhookUserId: string,
  mediaId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_BY_POST(webhookUserId, mediaId);

  if (!redis) return dbFallback();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const automations = await dbFallback();
    redis
      .set(key, JSON.stringify(automations), "EX", TTL.AUTOMATION_TTL)
      .catch(() => {});
    return automations;
  } catch (error: any) {
    return dbFallback();
  }
}

/**
 * Fetches automations matched by story from Redis.
 */
export async function getAutomationsByStoryR(
  webhookUserId: string,
  storyId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_BY_STORY(webhookUserId, storyId);

  if (!redis) return dbFallback();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const automations = await dbFallback();
    redis
      .set(key, JSON.stringify(automations), "EX", TTL.AUTOMATION_TTL)
      .catch(() => {});
    return automations;
  } catch (error: any) {
    return dbFallback();
  }
}

/**
 * Fetches specific automation by ID from Redis.
 */
export async function getAutomationByIdR(
  webhookUserId: string,
  automationId: string,
  dbFallback: () => Promise<Automation | null>,
): Promise<Automation | null> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATION_BY_ID(webhookUserId, automationId);

  if (!redis) return dbFallback();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const automation = await dbFallback();
    if (automation) {
      redis
        .set(key, JSON.stringify(automation), "EX", TTL.AUTOMATION_TTL)
        .catch(() => {});
    }
    return automation;
  } catch (error: any) {
    return dbFallback();
  }
}

/**
 * Fetches automations for RESPOND_TO_ALL_DMS flow.
 */
export async function getAutomationsForAccountDMR(
  webhookUserId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_FOR_ACCOUNT_DM(webhookUserId);

  if (!redis) return dbFallback();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const automations = await dbFallback();
    redis
      .set(key, JSON.stringify(automations), "EX", TTL.AUTOMATION_TTL)
      .catch(() => {});
    return automations;
  } catch (error: any) {
    return dbFallback();
  }
}

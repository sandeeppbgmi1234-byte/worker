import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import type { Automation } from "@prisma/client";

// All cache functions keyed by instaAccountId for strict account isolation
export async function getAutomationsByPostR(
  instaAccountId: string,
  mediaId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_BY_POST(instaAccountId, mediaId);

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

export async function getAutomationsByStoryR(
  instaAccountId: string,
  storyId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_BY_STORY(instaAccountId, storyId);

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

export async function getAutomationByIdR(
  automationId: string,
  dbFallback: () => Promise<Automation | null>,
): Promise<Automation | null> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATION_BY_ID(automationId);

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

export async function getAutomationsForAccountDMR(
  instaAccountId: string,
  dbFallback: () => Promise<Automation[]>,
): Promise<Automation[]> {
  const redis = getRedisClient();
  const key = KEYS.AUTOMATIONS_FOR_ACCOUNT_DM(instaAccountId);

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

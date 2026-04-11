import { prisma } from "../../db/db";
import { getCreditLimitForPlan } from "../../config/plans.config";
import { getRedisClient } from "../client";
import { KEYS } from "../keys";
import { logger } from "../../logger";

/**
 * Returns current credit state from Redis.
 */
export async function getCreditStateR(clerkUserId: string): Promise<{
  creditsUsed: number | null;
  creditLimit: number | null;
  subStatus: string | null;
  plan: string | null;
}> {
  const redis = getRedisClient();
  if (!redis)
    return {
      creditsUsed: null,
      creditLimit: null,
      subStatus: null,
      plan: null,
    };

  try {
    const [used, limit, status, plan] = await redis.mget(
      KEYS.CREDIT_USED(clerkUserId),
      KEYS.CREDIT_LIMIT(clerkUserId),
      KEYS.SUB_STATUS(clerkUserId),
      KEYS.PLAN(clerkUserId),
    );

    const parsedUsed = used !== null ? parseInt(used, 10) : null;
    const parsedLimit = limit !== null ? parseInt(limit, 10) : null;

    // Canonical status validation as per plans.config
    const ALLOWED_STATUSES = ["ACTIVE", "EXPIRED", "SOFT_PAUSED"];
    const validatedStatus =
      status && ALLOWED_STATUSES.includes(status) ? status : null;

    return {
      creditsUsed:
        parsedUsed !== null && !isNaN(parsedUsed) ? parsedUsed : null,
      creditLimit:
        parsedLimit !== null && !isNaN(parsedLimit) ? parsedLimit : null,
      subStatus: validatedStatus,
      plan: plan || null,
    };
  } catch (error: any) {
    logger.warn({ error, clerkUserId }, "getCreditStateR failed");
    return {
      creditsUsed: null,
      creditLimit: null,
      subStatus: null,
      plan: null,
    };
  }
}

/**
 * Persists credit state back into Redis (Self-Healing).
 */
export async function setCreditStateR(
  clerkUserId: string,
  creditsUsed: number,
  creditLimit: number,
  subStatus: string,
  plan: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();
    // Only set used if it doesn't exist (prevent overwriting active increments)
    pipeline.set(KEYS.CREDIT_USED(clerkUserId), creditsUsed.toString(), "NX");
    pipeline.set(KEYS.CREDIT_LIMIT(clerkUserId), creditLimit.toString());
    pipeline.set(KEYS.SUB_STATUS(clerkUserId), subStatus);
    pipeline.set(KEYS.PLAN(clerkUserId), plan);
    await pipeline.exec();
  } catch (error: any) {
    logger.warn({ error, clerkUserId }, "setCreditStateR failed");
  }
}

/**
 * Atomically checks and reserves credits using a Lua script.
 * Returns true if the reservation succeeded, false if over limit.
 * Throws if Redis is unavailable.
 */
export async function reserveCreditsRedis(
  clerkUserId: string,
  requested: number = 1,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) throw new Error("Redis unavailable");

  const usedKey = KEYS.CREDIT_USED(clerkUserId);
  const limitKey = KEYS.CREDIT_LIMIT(clerkUserId);

  // Lua script: if limit is -1 or (used + requested) <= limit then INCRBY
  // Lua script: treat missing limit as a cache miss (-2)
  const luaScript = `
    local used = tonumber(redis.call('get', KEYS[1]) or "0")
    local limitRaw = redis.call('get', KEYS[2])
    if not limitRaw then
      return -2
    end
    local limit = tonumber(limitRaw)
    local requested = tonumber(ARGV[1])

    if limit == -1 or (used + requested) <= limit then
      redis.call('incrby', KEYS[1], requested)
      return 1
    else
      return 0
    end
  `;

  const result = await redis.eval(luaScript, 2, usedKey, limitKey, requested);
  if (result === -2) throw new Error("Credit cache miss");
  return result === 1;
}

/**
 * Combined reservation logic: Redis-first with DB fallback.
 * Returns { success, dbReserved } to avoid double billing in flusher.
 */
export async function reserveCreditsR(
  clerkUserId: string,
  ownerId: string,
  requested: number = 1,
): Promise<{ success: boolean; dbReserved: boolean }> {
  try {
    const redisOk = await reserveCreditsRedis(clerkUserId, requested);
    return { success: redisOk, dbReserved: false };
  } catch (error: any) {
    logger.warn(
      { error: error.message, clerkUserId },
      "reserveCreditsRedis encountered a transient failure. Falling back to DB.",
    );
  }

  // Redis is down or failed, fallback to DB
  try {
    const success = await prisma.$transaction(async (tx) => {
      let ledger = await tx.creditLedger.findUnique({
        where: { userId: ownerId },
      });

      const userWithSub = await tx.user.findUnique({
        where: { id: ownerId },
        include: { subscription: true },
      });

      if (!userWithSub) return false;
      const sub = userWithSub.subscription;
      const creditLimit = getCreditLimitForPlan(sub?.plan);

      // Period rolling logic for DB fallback
      const isNewUser = !ledger;
      const isPeriodDifferent =
        ledger &&
        sub &&
        ledger.periodStart.getTime() !== sub.currentPeriodStart.getTime();

      if (isNewUser || isPeriodDifferent) {
        ledger = await tx.creditLedger.upsert({
          where: { userId: ownerId },
          create: {
            userId: ownerId,
            creditsUsed: 0,
            creditLimit,
            periodStart: sub?.currentPeriodStart ?? new Date(),
            periodEnd:
              sub?.currentPeriodEnd ??
              new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
          },
          update: {
            creditsUsed: 0,
            creditLimit,
            periodStart: sub?.currentPeriodStart ?? new Date(),
            periodEnd:
              sub?.currentPeriodEnd ??
              new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
          },
        });
      }

      if (!ledger) {
        throw new Error(
          `Failed to initialize or retrieve credit ledger for owner ${ownerId}`,
        );
      }

      if (
        ledger.creditLimit !== -1 &&
        ledger.creditsUsed + requested > ledger.creditLimit
      ) {
        return false;
      }

      await tx.creditLedger.update({
        where: { id: ledger.id },
        data: { creditsUsed: { increment: requested } },
      });
      return true;
    });
    return { success, dbReserved: success };
  } catch (error) {
    logger.error({ error, ownerId }, "reserveCreditsTx fallback failed");
    return { success: false, dbReserved: false };
  }
}

/**
 * Atomically increments credit usage.
 * Returns the new count.
 */
export async function incrementCreditUsedR(
  clerkUserId: string,
): Promise<number> {
  const redis = getRedisClient();
  if (!redis) throw new Error("Redis unavailable for incrementCreditUsedR");

  const key = KEYS.CREDIT_USED(clerkUserId);
  try {
    const multi = redis.multi();
    multi.incr(key);
    multi.ttl(key);

    const results = await multi.exec();
    if (!results) throw new Error("Atomic multi.exec() failed");

    const [incrErr, count] = results[0] as [Error | null, number];
    const [ttlErr, ttl] = results[1] as [Error | null, number];

    if (incrErr) throw incrErr;
    if (ttlErr) throw ttlErr;

    // Set 6-month TTL if key is new
    if (ttl === -1) {
      await redis.expire(key, 180 * 24 * 60 * 60);
    }

    return count;
  } catch (error: any) {
    logger.error(
      { error: error.message, clerkUserId },
      "Redis incrementCreditUsedR failed. Invalidating cache to trigger self-healing.",
    );
    // Invalidate everything for this user so the guard or flusher rebuilds from DB
    await redis
      .del(
        KEYS.CREDIT_USED(clerkUserId),
        KEYS.CREDIT_LIMIT(clerkUserId),
        KEYS.SUB_STATUS(clerkUserId),
        KEYS.PLAN(clerkUserId),
      )
      .catch(() => {});
    throw error;
  }
}

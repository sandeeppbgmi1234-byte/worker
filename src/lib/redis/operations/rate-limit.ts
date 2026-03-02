import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { RedisError } from "../errors";
import { logger } from "../../utils/pino";
import { RATE_LIMIT_THRESHOLDS } from "../../../config/instagram.config";
import { InstagramRateLimitError } from "../../instagram/api/api-errors";

/**
 * Domain: Meta Graph API Rate Limits
 * Enforces dynamic application-level and account-level API call budgets.
 */

/**
 * Stores limits extracted dynamically from the "X-App-Usage" headers.
 */
export async function updateRateLimitsFromHeaders(
  instagramUserId: string,
  appUsage: Record<string, any> | null,
  businessUsage: Record<string, any> | null,
) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();

    if (appUsage && typeof appUsage.call_count === "number") {
      pipeline.set(KEYS.APP_USAGE(), appUsage.call_count, "EX", TTL.API_USAGE);
    }

    if (businessUsage) {
      let maxAccountUsage = 0;
      for (const key of Object.keys(businessUsage)) {
        const metrics = businessUsage[key];
        if (Array.isArray(metrics) && metrics.length > 0) {
          const count = metrics[0].call_count;
          if (typeof count === "number" && count > maxAccountUsage) {
            maxAccountUsage = count;
          }
        }
      }

      if (maxAccountUsage > 0) {
        pipeline.set(
          KEYS.ACCOUNT_USAGE(instagramUserId),
          maxAccountUsage,
          "EX",
          TTL.API_USAGE,
        );
      }
    }

    await pipeline.exec();
    logger.debug({ instagramUserId }, "[Redis:RateLimit] Headers synchronized");
  } catch (error: any) {
    logger.error(
      { instagramUserId, error: error.message },
      "[Redis:RateLimit] Failed to update headers",
    );
  }
}

/**
 * Throws InstagramRateLimitError if the current API usage is dangerously strict,
 * allowing the executing worker to gracefully abort and transfer the job to the Delayed queue.
 */
export async function checkRateLimits(instagramUserId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn(
      { instagramUserId },
      "[Redis:RateLimit] Client down, falling open to API",
    );
    return; // Fallback: Allow API call, rely on standard try/catch if HTTP 429 returns natively
  }

  try {
    const [appUsageStr, accountUsageStr] = await redis.mget(
      KEYS.APP_USAGE(),
      KEYS.ACCOUNT_USAGE(instagramUserId),
    );

    const appUsage = appUsageStr ? parseInt(appUsageStr, 10) : 0;
    const accountUsage = accountUsageStr ? parseInt(accountUsageStr, 10) : 0;

    if (appUsage >= RATE_LIMIT_THRESHOLDS.APP_USAGE_STOP_PERCENT) {
      logger.warn(
        { appUsage, threshold: RATE_LIMIT_THRESHOLDS.APP_USAGE_STOP_PERCENT },
        "[Redis:RateLimit] App Limit Exceeded",
      );
      throw new InstagramRateLimitError(
        `App-Level Rate Limit at ${appUsage}%`,
        true,
      );
    }

    if (accountUsage >= RATE_LIMIT_THRESHOLDS.ACCOUNT_USAGE_STOP_PERCENT) {
      logger.warn(
        {
          instagramUserId,
          accountUsage,
          threshold: RATE_LIMIT_THRESHOLDS.ACCOUNT_USAGE_STOP_PERCENT,
        },
        "[Redis:RateLimit] Account Limit Exceeded",
      );
      throw new InstagramRateLimitError(
        `Account-Level Rate Limit at ${accountUsage}%`,
        false,
      );
    }
  } catch (error: any) {
    if (error instanceof InstagramRateLimitError) throw error; // Re-throw native

    // Swallow redis unhandled errors and fall open so the queue job continues
    logger.error(
      { instagramUserId, error: error.message },
      "[Redis:RateLimit] Rate limit check failed, falling open",
    );
  }
}

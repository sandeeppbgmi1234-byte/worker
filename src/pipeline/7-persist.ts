import { ExecutionOutcome } from "../types";
import { executeTransaction } from "../repositories/repository-utils";
import { Result, ok, fail } from "../helpers/result";
import { PersistenceError } from "../errors/pipeline.errors";
import { getRedisClient } from "../redis/client";
import { KEYS } from "../redis/keys";
import { logger } from "../logger";
import { setEventHandledR } from "../redis/operations/event";
import { incrementCreditUsedR } from "../redis/operations/credits";
import { getCreditLimitForPlan } from "../config/plans.config";
import { prisma } from "../db/db";

/**
 * Persists execution outcomes by pushing them to a Redis buffer (Write-Behind).
 * If Redis is down, it falls back to synchronous DB persistence to prevent data loss.
 */
export async function persistOutcomes(
  outcomes: ExecutionOutcome[],
): Promise<Result<void, PersistenceError>> {
  if (outcomes.length === 0) {
    return ok(undefined);
  }

  const redis = getRedisClient();

  if (!redis) {
    logger.warn(
      "Redis client not available for buffering. Falling back to synchronous DB persistence.",
    );
    const syncRes = await persistOutcomesSync(outcomes);
    return syncRes;
  }

  try {
    const pipeline = redis.pipeline();
    const serializedOutcomes = outcomes.map((o) => JSON.stringify(o));

    // Batch push to Redis list
    pipeline.rpush(KEYS.PENDING_OUTCOMES, ...serializedOutcomes);
    const results = await pipeline.exec();

    if (results) {
      for (const [err] of results) {
        if (err) {
          throw new Error(`Redis pipeline command failed: ${err.message}`);
        }
      }
    }

    // Now that outcomes are safely buffered, mark events as permanently handled
    const uniqueEvents = Array.from(
      new Map(outcomes.map((o) => [o.eventId, o])).values(),
    );
    await Promise.all(
      uniqueEvents.map((o) => setEventHandledR(o.webhookUserId, o.eventId)),
    );

    return ok(undefined);
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "Failed to buffer outcomes in Redis. Falling back to synchronous DB.",
    );
    return persistOutcomesSync(outcomes);
  }
}

/**
 * Original synchronous persistence logic — now used as a failsafe
 */
async function persistOutcomesSync(
  outcomes: ExecutionOutcome[],
): Promise<Result<void, PersistenceError>> {
  let hasFailure = false;
  let lastError: any = null;

  for (const outcome of outcomes) {
    try {
      const isBillable = ["SUCCESS", "OPENING_MESSAGE_SENT"].includes(
        outcome.status,
      );

      await executeTransaction(
        async (tx) => {
          await tx.automationExecution.create({
            data: {
              automationId: outcome.automationId,
              commentId: outcome.eventId || "unknown_event",
              commentText: outcome.commentData.text || "Interaction",
              commentUsername:
                outcome.commentData.username ||
                outcome.commentData.senderId ||
                "unknown",
              commentUserId:
                outcome.commentData.userId ||
                outcome.commentData.senderId ||
                "unknown",
              actionType: outcome.actionType,
              sentMessage: outcome.sentMessage || "",
              status: outcome.status,
              errorMessage: outcome.errorMessage || "",
              instagramMessageId: outcome.instagramMessageId || "",
              executedAt: new Date(),
              billed: isBillable,
            },
          });

          if (isBillable) {
            // AUTHORITATIVE BILLING: Update DB ledger inside transaction
            const userState = await tx.user.findUnique({
              where: { clerkId: outcome.clerkUserId },
              include: { subscription: true },
            });

            if (userState) {
              const sub = userState.subscription;
              const creditLimit = getCreditLimitForPlan(sub?.plan);

              await tx.creditLedger.upsert({
                where: { userId: userState.id },
                create: {
                  userId: userState.id,
                  creditsUsed: 1,
                  creditLimit,
                  periodStart: sub?.currentPeriodStart ?? new Date(),
                  periodEnd:
                    sub?.currentPeriodEnd ??
                    new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
                },
                update: {
                  creditsUsed: { increment: 1 },
                },
              });
            }
          }

          if (outcome.status === "SUCCESS") {
            await tx.automation.update({
              where: { id: outcome.automationId },
              data: {
                timesTriggered: { increment: 1 },
                lastTriggeredAt: new Date(),
              },
            });
          }

          // Mark as handled after successful DB write
          if (outcome.eventId) {
            await setEventHandledR(outcome.webhookUserId, outcome.eventId);
          }
        },
        {
          operation: "persistPipelineOutcomeSync",
          models: ["AutomationExecution", "Automation", "CreditLedger"],
        },
      );

      // POST-COMMIT: Update Redis cache if available
      if (isBillable) {
        await incrementCreditUsedR(outcome.clerkUserId).catch(() => {});
      }
    } catch (error: any) {
      hasFailure = true;
      lastError = error;
      logger.error(
        {
          automationId: outcome.automationId,
          eventId: outcome.eventId,
          error: error.message,
        },
        "CRITICAL PERSISTENCE FAILURE: Both Redis buffer and Synchronous DB fallback failed. Flagging for job retry.",
      );
    }
  }

  if (hasFailure) {
    return fail(
      new PersistenceError(
        `Failed to persist ${outcomes.length} outcomes in sync fallback.`,
        lastError,
      ),
    );
  }

  return ok(undefined);
}

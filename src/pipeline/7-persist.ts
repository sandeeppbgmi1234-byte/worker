import { ExecutionOutcome } from "../types";
import { executeTransaction } from "../repositories/repository-utils";
import { Result, ok, fail } from "../helpers/result";
import {
  PersistenceError,
  PipelineRetryableError,
} from "../errors/pipeline.errors";
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
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "Failed to buffer outcomes in Redis. Falling back to synchronous DB.",
    );
    return persistOutcomesSync(outcomes);
  }

  // Identify which events should NOT be marked handled because they have at least one retryable outcome
  const retryableEventIds = new Set(
    outcomes
      .filter((o) => o.retryable)
      .map((o) => `${o.webhookUserId}:${o.eventId}`),
  );

  // Now that outcomes are safely buffered, mark non-retryable events as permanently handled
  try {
    const uniqueEvents = Array.from(
      new Map(
        outcomes
          .filter(
            (o) => !retryableEventIds.has(`${o.webhookUserId}:${o.eventId}`),
          )
          .map((o) => [`${o.webhookUserId}:${o.eventId}`, o]),
      ).values(),
    );

    await Promise.all(
      uniqueEvents.map((o) =>
        setEventHandledR(o.webhookUserId, o.eventId).catch((e) =>
          logger.warn(
            { eventId: o.eventId, err: e.message },
            "Minor: Failed to mark event as handled in Redis after successful buffering",
          ),
        ),
      ),
    );
  } catch (error: any) {
    // Non-fatal error as the buffer is already written
    logger.warn(
      { error: error.message },
      "Outcome marker set partially failed",
    );
  }

  // If any outcomes are retryable, throw to trigger BullMQ retry for the whole batch
  const hasRetryable = outcomes.some((o) => o.retryable);
  if (hasRetryable) {
    throw new PipelineRetryableError(
      "Persistence",
      "Batch contains retryable outcomes. Triggering job retry.",
      { retryableCount: outcomes.filter((o) => o.retryable).length },
    );
  }

  return ok(undefined);
}

/**
 * Original synchronous persistence logic — now used as a failsafe
 */
async function persistOutcomesSync(
  outcomes: ExecutionOutcome[],
): Promise<Result<void, PersistenceError | PipelineRetryableError>> {
  let hasFailure = false;
  let lastError: any = null;

  for (const outcome of outcomes) {
    try {
      const isBillable = ["SUCCESS", "OPENING_MESSAGE_SENT"].includes(
        outcome.status,
      );

      await executeTransaction(
        async (tx) => {
          const executionKey = {
            eventId: outcome.eventId || "unknown_event",
            automationId: outcome.automationId,
          };

          const execution = await tx.automationExecution.upsert({
            where: {
              eventId_automationId: executionKey,
            },
            update: {
              status: outcome.status,
              errorMessage: outcome.errorMessage || "",
              instagramMessageId: outcome.instagramMessageId || "",
              sentMessage: outcome.sentMessage || "",
              executedAt: new Date(),
              // Do not overwrite billed if it's already true
            },
            create: {
              automationId: outcome.automationId,
              eventId: executionKey.eventId,
              eventText: outcome.commentData.text || "Interaction",
              senderUsername:
                outcome.commentData.username ||
                outcome.commentData.senderId ||
                "unknown",
              senderId:
                outcome.commentData.userId ||
                outcome.commentData.senderId ||
                "unknown",
              actionType: outcome.actionType,
              sentMessage: outcome.sentMessage || "",
              status: outcome.status,
              errorMessage: outcome.errorMessage || "",
              instagramMessageId: outcome.instagramMessageId || "",
              executedAt: new Date(),
              billed: !!outcome.dbReserved,
            },
          });

          const shouldBillNow =
            isBillable && !execution.billed && !outcome.dbReserved;

          if (shouldBillNow) {
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

              // Mark execution as billed successfully
              await tx.automationExecution.update({
                where: { id: execution.id },
                data: { billed: true },
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
        },
        {
          operation: "persistPipelineOutcomeSync",
          models: ["AutomationExecution", "Automation", "CreditLedger"],
        },
      );

      // POST-COMMIT: Update Redis state if available, but only if not retryable
      if (outcome.eventId && !outcome.retryable) {
        await setEventHandledR(outcome.webhookUserId, outcome.eventId).catch(
          () => {},
        );
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

  const hasRetryable = outcomes.some((o) => o.retryable);
  if (hasRetryable) {
    return fail(
      new PipelineRetryableError(
        "PersistenceSync",
        "Batch contains retryable outcomes in sync fallback. Triggering job retry.",
        { retryableCount: outcomes.filter((o) => o.retryable).length },
      ),
    );
  }

  return ok(undefined);
}

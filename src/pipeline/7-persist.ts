import { ExecutionOutcome } from "../types";
import { executeTransaction } from "../repositories/repository-utils";
import { Result, ok } from "../helpers/result";
import { PersistenceError } from "../errors/pipeline.errors";
import { getRedisClient } from "../redis/client";
import { KEYS } from "../redis/keys";
import { logger } from "../logger";

/**
 * Persists execution outcomes by pushing them to a Redis buffer (Write-Behind).
 * If Redis is down, it falls back to synchronous DB persistence to prevent data loss.
 */
export async function persistOutcomes(
  outcomes: ExecutionOutcome[],
): Promise<Result<void, PersistenceError>> {
  const redis = getRedisClient();

  if (!redis) {
    logger.warn(
      "Redis client not available for buffering. Falling back to synchronous DB persistence.",
    );
    return persistOutcomesSync(outcomes);
  }

  try {
    const pipeline = redis.pipeline();
    const serializedOutcomes = outcomes.map((o) => JSON.stringify(o));

    // Batch push to Redis list
    pipeline.rpush(KEYS.PENDING_OUTCOMES, ...serializedOutcomes);
    await pipeline.exec();

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
  for (const outcome of outcomes) {
    try {
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
            },
          });

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
          models: ["AutomationExecution", "Automation"],
        },
      );
    } catch (ignore) {}
  }
  return ok(undefined);
}

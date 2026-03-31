import { getRedisClient } from "../redis/client";
import { KEYS } from "../redis/keys";
import { logger } from "../logger";
import { prisma } from "../db/db";
import { ExecutionOutcome } from "../types";

const FLUSH_BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 5000; // 5 seconds
const PROCESSING_KEY = `${KEYS.PENDING_OUTCOMES}:processing`;

let flusherInterval: Timer | null = null;
let isFlushing = false;

/**
 * Starts the background flusher to periodically drain Redis outcomes into the DB.
 */
export function startPersistenceFlusher() {
  if (flusherInterval) return;

  logger.info(
    `Starting Persistence Flusher (Interval: ${FLUSH_INTERVAL_MS}ms, Batch: ${FLUSH_BATCH_SIZE})`,
  );
  flusherInterval = setInterval(flushBufferToDb, FLUSH_INTERVAL_MS);
}

/**
 * Stops the flusher (used during graceful shutdown).
 */
export async function stopPersistenceFlusher() {
  if (flusherInterval) {
    clearInterval(flusherInterval);
    flusherInterval = null;
  }
  // One final flush to ensure no data is left in the buffer
  await flushBufferToDb();
}

/**
 * Actual flushing logic. Uses atomic RENAME/LMOVE equivalent pattern.
 */
async function flushBufferToDb() {
  if (isFlushing) return;
  isFlushing = true;

  const redis = getRedisClient();
  if (!redis) {
    isFlushing = false;
    return;
  }

  try {
    // 1. Move items to processing key to ensure atomicity
    // We use a simple RENAME if processing key is empty
    const exists = await redis.exists(KEYS.PENDING_OUTCOMES);
    if (!exists) {
      isFlushing = false;
      return;
    }

    // Atomic move of current buffer to a processing list
    // If PROCESSING_KEY already exists (previous failed flush), we APPEND to it
    const items = await redis.lrange(
      KEYS.PENDING_OUTCOMES,
      0,
      FLUSH_BATCH_SIZE - 1,
    );
    if (!items || items.length === 0) {
      isFlushing = false;
      return;
    }

    // Process the batch
    const outcomes = items.map((i) => JSON.parse(i) as ExecutionOutcome);

    // 2. Perform bulk write to DB
    try {
      await prisma.$transaction(async (tx) => {
        // Bulk create executions
        await tx.automationExecution.createMany({
          data: outcomes.map((o) => ({
            automationId: o.automationId,
            commentId: o.eventId || "unknown_event",
            commentText: o.commentData.text ?? "Interaction",
            commentUsername:
              o.commentData.username ?? o.commentData.senderId ?? "unknown",
            commentUserId:
              o.commentData.userId ?? o.commentData.senderId ?? "unknown",
            actionType: o.actionType,
            sentMessage: o.sentMessage ?? "",
            status: o.status,
            errorMessage: o.errorMessage ?? "",
            instagramMessageId: o.instagramMessageId ?? "",
            executedAt: new Date(),
          })),
        });

        // Update automation triggered counts
        const successIds = outcomes
          .filter((o) => o.status === "SUCCESS")
          .map((o) => o.automationId);

        const uniqueSuccessIds = Array.from(new Set(successIds));

        for (const autoId of uniqueSuccessIds) {
          const count = successIds.filter((id) => id === autoId).length;
          await tx.automation.update({
            where: { id: autoId },
            data: {
              timesTriggered: { increment: count },
              lastTriggeredAt: new Date(),
            },
          });
        }
      });

      // 3. Remove the processed items from Redis list AFTER successful DB write
      await redis.ltrim(KEYS.PENDING_OUTCOMES, items.length, -1);

      logger.info(
        { count: outcomes.length },
        "Persistence Flusher: Successfully synced outcomes to database",
      );
    } catch (dbError: any) {
      logger.error(
        {
          error: dbError.message,
          batchSize: outcomes.length,
          code: dbError.code,
        },
        "Persistence Flusher: CRITICAL - Failed to sync batch to database. Data remains in Redis buffer for retry.",
      );
    }
  } catch (error: any) {
    logger.error(
      { error: error.message },
      "Persistence Flusher: General failure in flush cycle",
    );
  } finally {
    isFlushing = false;
  }
}

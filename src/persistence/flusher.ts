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

    // 1. VAULT-FIRST SAFETY: Check if we have a stranded batch from a previous crash
    let items = await redis.lrange(PROCESSING_KEY, 0, -1);
    let isStrandedBatch = items && items.length > 0;

    if (!isStrandedBatch) {
      // No stranded batch, attempt to move a fresh batch to the Vault atomically
      const moveScript = `
        local items = redis.call('lrange', KEYS[1], 0, ARGV[1] - 1)
        if #items > 0 then
          redis.call('lpush', KEYS[2], unpack(items))
          redis.call('ltrim', KEYS[1], #items, -1)
        end
        return items
      `;

      items = await (redis as any).eval(
        moveScript,
        2,
        KEYS.PENDING_OUTCOMES,
        PROCESSING_KEY,
        FLUSH_BATCH_SIZE,
      );
    } else {
      logger.warn(
        { count: items.length },
        "Persistence Flusher: Found stranded batch in vault. Resolving first.",
      );
    }

    if (!items || items.length === 0) {
      isFlushing = false;
      return;
    }

    // Process the batch (either fresh or stranded)
    const outcomes = items.map(
      (i: string) => JSON.parse(i) as ExecutionOutcome,
    );

    // 2. Perform bulk write to DB
    try {
      await prisma.$transaction(async (tx) => {
        // Idempotent UPSERT for each outcome
        // This handles transitions (e.g. OPENING_MESSAGE_SENT -> SUCCESS) on the same comment
        await Promise.all(
          outcomes.map((o: ExecutionOutcome) =>
            tx.automationExecution.upsert({
              where: {
                commentId_automationId: {
                  commentId: o.eventId || "unknown_event",
                  automationId: o.automationId,
                },
              },
              update: {
                status: o.status,
                errorMessage: o.errorMessage ?? "",
                instagramMessageId: o.instagramMessageId ?? "",
                sentMessage: o.sentMessage ?? "",
                executedAt: new Date(),
              },
              create: {
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
              },
            }),
          ),
        );

        // Update automation triggered counts using a Frequency Map (O(n) instead of O(n^2))
        const successIds = outcomes
          .filter((o: ExecutionOutcome) => o.status === "SUCCESS")
          .map((o: ExecutionOutcome) => o.automationId);

        const counts: Record<string, number> = {};
        for (const id of successIds) {
          counts[id] = (counts[id] || 0) + 1;
        }

        for (const [autoId, count] of Object.entries(counts)) {
          await tx.automation.update({
            where: { id: autoId },
            data: {
              timesTriggered: { increment: count },
              lastTriggeredAt: new Date(),
            },
          });
        }

        // --- BILLING SYNC: Aggregate and update CreditLedger ---
        const billableOutcomes = outcomes.filter((o: ExecutionOutcome) =>
          ["SUCCESS", "OPENING_MESSAGE_SENT"].includes(o.status),
        );

        if (billableOutcomes.length > 0) {
          const billingCounts: Record<string, number> = {};
          for (const o of billableOutcomes) {
            billingCounts[o.clerkUserId] =
              (billingCounts[o.clerkUserId] || 0) + 1;
          }

          for (const [clerkId, count] of Object.entries(billingCounts)) {
            await tx.user
              .update({
                where: { clerkId },
                data: {
                  creditLedger: {
                    update: {
                      creditsUsed: { increment: count },
                    },
                  },
                },
              })
              .catch((err) => {
                logger.error(
                  { clerkId, err: err.message },
                  "Failed to update CreditLedger in flusher",
                );
              });
          }
        }
      });

      // 3. Clear the Vault AFTER successful DB write
      await redis.del(PROCESSING_KEY);

      logger.info(
        { count: outcomes.length },
        "Persistence Flusher: Successfully synced outcomes to database from vault",
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

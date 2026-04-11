import { getRedisClient } from "../redis/client";
import { KEYS } from "../redis/keys";
import { logger } from "../logger";
import { prisma } from "../db/db";
import { ExecutionOutcome } from "../types";
import { getCreditLimitForPlan } from "../config/plans.config";

const FLUSH_BATCH_SIZE = 500;
const FLUSH_INTERVAL_MS = 5000; // 5 seconds
const PROCESSING_KEY = `${KEYS.PENDING_OUTCOMES}:processing`;

let flusherInterval: ReturnType<typeof setInterval> | null = null;
let isFlushing = false;
let activeFlushPromise: Promise<void> | null = null;

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

  // If a flush is currently running, wait for it to finish first
  if (activeFlushPromise) {
    await activeFlushPromise;
  }

  // One final flush to ensure no data is left in the buffer
  await flushBufferToDb();
}

/**
 * Actual flushing logic. Uses atomic RENAME/LMOVE equivalent pattern.
 */
/**
 * Actual flushing logic. Uses atomic RENAME/LMOVE equivalent pattern.
 */
async function flushBufferToDb(): Promise<void> {
  if (isFlushing) return activeFlushPromise ?? Promise.resolve();
  isFlushing = true;

  activeFlushPromise = (async () => {
    const redis = getRedisClient();
    if (!redis) return;

    try {
      // 1. Check if we have items to process
      const [pendingExists, processingExists] = await Promise.all([
        redis.exists(KEYS.PENDING_OUTCOMES),
        redis.exists(PROCESSING_KEY),
      ]);

      if (!pendingExists && !processingExists) return;

      // 1. VAULT-FIRST SAFETY: Check for stranded batch
      let items = await redis.lrange(PROCESSING_KEY, 0, -1);
      let isStrandedBatch = items && items.length > 0;

      if (!isStrandedBatch) {
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
      }

      if (!items || items.length === 0) return;

      const rawOutcomes = items.map(
        (i: string) => JSON.parse(i) as ExecutionOutcome,
      );

      // DEDUPLICATION
      const BILLABLE_STATUSES = ["SUCCESS", "OPENING_MESSAGE_SENT"];
      const dedupedMap = new Map<string, ExecutionOutcome>();
      for (const o of rawOutcomes) {
        const key = `${o.eventId || "unknown_event"}|${o.automationId}`;
        const existing = dedupedMap.get(key);
        const isNewBillable = BILLABLE_STATUSES.includes(o.status);
        const isExistingBillable =
          existing && BILLABLE_STATUSES.includes(existing.status);

        if (
          !existing ||
          (isNewBillable && !isExistingBillable) ||
          (o.status === "SUCCESS" && existing.status !== "SUCCESS")
        ) {
          dedupedMap.set(key, o);
        }
      }
      const outcomes = Array.from(dedupedMap.values()).map((o) => ({
        ...o,
        eventId: o.eventId || "unknown_event",
      }));

      // 2. Write to DB
      try {
        await prisma.$transaction(async (tx) => {
          const existingExecutions = await tx.automationExecution.findMany({
            where: {
              OR: outcomes.map((o) => ({
                eventId: o.eventId,
                automationId: o.automationId,
              })),
            },
            select: {
              eventId: true,
              automationId: true,
              billed: true,
              status: true,
            },
          });

          const existingMap = new Map<
            string,
            { billed: boolean; status: string }
          >(
            existingExecutions.map((e) => [
              `${e.eventId}:${e.automationId}`,
              { billed: e.billed, status: e.status },
            ]),
          );

          await Promise.all(
            outcomes.map((o) => {
              const existing = existingMap.get(
                `${o.eventId}:${o.automationId}`,
              );
              (o as any).isNew = !existing;

              // PRECEDENCE: Preserve SUCCESS
              const finalStatus =
                existing?.status === "SUCCESS" ? "SUCCESS" : o.status;

              return tx.automationExecution.upsert({
                where: {
                  eventId_automationId: {
                    eventId: o.eventId,
                    automationId: o.automationId,
                  },
                },
                update: {
                  status: finalStatus,
                  errorMessage: o.errorMessage ?? "",
                  instagramMessageId: o.instagramMessageId ?? "",
                  sentMessage: o.sentMessage ?? "",
                  executedAt: new Date(),
                  billed:
                    o.dbReserved || existing?.billed
                      ? { set: true }
                      : undefined,
                },
                create: {
                  automationId: o.automationId,
                  eventId: o.eventId,
                  eventText: o.commentData.text ?? "Interaction",
                  senderUsername:
                    o.commentData.username ??
                    o.commentData.senderId ??
                    "unknown",
                  senderId:
                    o.commentData.userId ?? o.commentData.senderId ?? "unknown",
                  actionType: o.actionType,
                  sentMessage: o.sentMessage ?? "",
                  status: o.status,
                  errorMessage: o.errorMessage ?? "",
                  instagramMessageId: o.instagramMessageId ?? "",
                  executedAt: new Date(),
                  billed: !!o.dbReserved,
                },
              });
            }),
          );

          const newlyBillable = outcomes.filter((o) => {
            const existing = existingMap.get(`${o.eventId}:${o.automationId}`);
            return (
              ["SUCCESS", "OPENING_MESSAGE_SENT"].includes(o.status) &&
              !(existing?.billed ?? false) &&
              !o.dbReserved
            );
          });

          if (newlyBillable.length > 0) {
            const billedKeys: { eventId: string; automationId: string }[] = [];
            const billingCounts: Record<string, number> = {};

            for (const o of newlyBillable) {
              billingCounts[o.clerkUserId] =
                (billingCounts[o.clerkUserId] || 0) + 1;
            }

            for (const [clerkId, count] of Object.entries(billingCounts)) {
              const userState = await tx.user.findUnique({
                where: { clerkId },
                include: { subscription: true },
              });

              if (userState) {
                const sub = userState.subscription;
                const creditLimit = getCreditLimitForPlan(sub?.plan);
                const ledger = await tx.creditLedger.findUnique({
                  where: { userId: userState.id },
                });

                const isPeriodDifferent =
                  ledger &&
                  sub &&
                  ledger.periodStart.getTime() !==
                    sub.currentPeriodStart.getTime();

                if (isPeriodDifferent) {
                  await tx.creditLedger.update({
                    where: { id: ledger.id },
                    data: {
                      creditsUsed: count,
                      creditLimit,
                      periodStart: sub.currentPeriodStart,
                      periodEnd: sub.currentPeriodEnd,
                    },
                  });
                } else {
                  await tx.creditLedger.upsert({
                    where: { userId: userState.id },
                    create: {
                      userId: userState.id,
                      creditsUsed: count,
                      creditLimit,
                      periodStart: sub?.currentPeriodStart ?? new Date(),
                      periodEnd:
                        sub?.currentPeriodEnd ??
                        new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
                    },
                    update: { creditsUsed: { increment: count } },
                  });
                }

                newlyBillable
                  .filter((o) => o.clerkUserId === clerkId)
                  .forEach((o) =>
                    billedKeys.push({
                      eventId: o.eventId,
                      automationId: o.automationId,
                    }),
                  );
              }
            }

            if (billedKeys.length > 0) {
              await Promise.all(
                billedKeys.map((key) =>
                  tx.automationExecution.update({
                    where: { eventId_automationId: key },
                    data: { billed: true },
                  }),
                ),
              );
            }
          }

          const newSuccessIds = outcomes
            .filter((o: any) => o.status === "SUCCESS" && o.isNew)
            .map((o: any) => o.automationId);

          if (newSuccessIds.length > 0) {
            const counts: Record<string, number> = {};
            for (const id of newSuccessIds) counts[id] = (counts[id] || 0) + 1;
            for (const [autoId, count] of Object.entries(counts)) {
              await tx.automation.update({
                where: { id: autoId },
                data: {
                  timesTriggered: { increment: count },
                  lastTriggeredAt: new Date(),
                },
              });
            }
          }
        });

        await redis.del(PROCESSING_KEY);
        logger.info(
          { count: outcomes.length },
          "Persistence Flusher: Successfully synced outcomes",
        );
      } catch (dbError: any) {
        logger.error(
          { error: dbError.message },
          "Persistence Flusher: DB Sync Failed",
        );
      }
    } catch (err: any) {
      logger.error(
        { error: err.message },
        "Persistence Flusher: General failure",
      );
    }
  })();

  activeFlushPromise.finally(() => {
    isFlushing = false;
    activeFlushPromise = null;
  });

  return activeFlushPromise;
}

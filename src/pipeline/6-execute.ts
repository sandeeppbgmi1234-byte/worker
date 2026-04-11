import { ExecutionOutcome, GuardedEvent } from "../types";
import {
  ExecutionError,
  PipelineError,
  PipelineRetryableError,
} from "../errors/pipeline.errors";
import { executeDmDelivery } from "../branches/dm-delivery";
import { executeAskToFollow } from "../branches/ask-to-follow";
import { executeOpeningMessage } from "../branches/opening-message";
import { Result, ok, fail } from "../helpers/result";
import {
  clearAskResolvedR,
  setPendingConfirmationR,
  clearPendingConfirmationR,
  setUserCooldownR,
  setAskResolvedR,
  setAccountSpamGuardR,
} from "../redis/operations/cooldown";
import { QUICK_REPLIES } from "../config/instagram.config";
import { logger } from "../logger";
import { getRedisClient } from "../redis/client";
import { KEYS, TTL } from "../redis/keys";
import { executePublicReply } from "../branches/public-reply";

/**
 * Executes automation actions for a batch of guarded events.
 * Stage 6: Execution
 */
export async function executeEvents(
  guardedEvents: GuardedEvent[],
): Promise<Result<ExecutionOutcome[], ExecutionError>> {
  const executionResults = await Promise.allSettled(
    guardedEvents.map(async (wrapper) => {
      let eventId = "";
      let userId = "";
      switch (wrapper.event.type) {
        case "COMMENT":
          eventId = wrapper.event.event.id;
          userId = wrapper.event.event.userId;
          break;
        case "STORY_REPLY":
        case "DM_MESSAGE":
        case "QUICK_REPLY":
          eventId = wrapper.event.event.messageId;
          userId = wrapper.event.event.senderId;
          break;
        default:
          break;
      }

      const qrPayload =
        wrapper.event.type === "QUICK_REPLY" ? wrapper.event.payload : "";
      const isFollowConfirmFlow = qrPayload.startsWith(
        QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX,
      );
      const isOpeningMessageFlow = qrPayload.startsWith(
        QUICK_REPLIES.OPENING_MESSAGE.PAYLOAD_PREFIX,
      );

      try {
        // --- CRITICAL-2: ACQUIRE PER-USER-PER-ACCOUNT EXECUTION LOCK (30s) ---
        if (userId) {
          const lockKey = KEYS.EXECUTION_LOCK(wrapper.accountId, userId);
          const redis = getRedisClient();
          if (redis) {
            const lockToken = Math.random().toString(36).substring(2, 15);
            const acquired = await redis.set(
              lockKey,
              lockToken,
              "EX",
              30,
              "NX",
            );
            if (acquired !== "OK") {
              logger.info(
                { userId, accountId: wrapper.accountId, eventId },
                "Execution lock held by another thread. Rethrowing for retry.",
              );
              throw new PipelineRetryableError(
                "ExecutionLockAcquisition",
                `Lock contention: Execution lock held for user ${userId}`,
                { userId, accountId: wrapper.accountId, eventId },
              );
            }
            try {
              return await runExecutionFlow(
                wrapper,
                eventId,
                userId,
                isFollowConfirmFlow,
                isOpeningMessageFlow,
              );
            } finally {
              try {
                await redis.eval(
                  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                  1,
                  lockKey,
                  lockToken,
                );
              } catch (err) {
                logger.debug(
                  { lockKey, error: err },
                  "Failed to release lock cleanly",
                );
              }
            }
          }
        }

        return await runExecutionFlow(
          wrapper,
          eventId,
          userId,
          isFollowConfirmFlow,
          isOpeningMessageFlow,
        );
      } catch (err: any) {
        logger.error(
          { eventId, userId, error: err.message },
          "Unexpected error in executeEvents wrapper. Rethrowing for pipeline retry.",
        );
        throw err;
      }
    }),
  );

  const flatOutcomes: ExecutionOutcome[] = [];
  const errors: any[] = [];

  for (const res of executionResults) {
    if (res.status === "fulfilled") {
      flatOutcomes.push(...res.value);
    } else {
      errors.push(res.reason);
    }
  }

  if (errors.length > 0) {
    logger.error(
      { errorCount: errors.length },
      "Batch execution failed with errors. Failing stage to trigger pipeline retry.",
    );
    // Return the first error or a combined error
    return fail(
      errors[0] instanceof PipelineError
        ? errors[0]
        : new ExecutionError(
            "Execution",
            "Multi-event execution failure",
            { errorCount: errors.length },
            errors[0],
          ),
    );
  }

  return ok(flatOutcomes);
}

/**
 * Internal logic for executing multiple automations for a single event.
 */
async function runExecutionFlow(
  wrapper: GuardedEvent,
  eventId: string,
  userId: string,
  isFollowConfirmFlow: boolean,
  isOpeningMessageFlow: boolean,
): Promise<ExecutionOutcome[]> {
  const automationResults = await Promise.allSettled(
    wrapper.safeAutomations.map(async (automation) => {
      try {
        // 0. SELF-HEALING: Clean slate for new threads
        if (
          (wrapper.event.type === "COMMENT" ||
            wrapper.event.type === "STORY_REPLY" ||
            wrapper.event.type === "DM_MESSAGE") &&
          userId
        ) {
          await Promise.all([
            clearAskResolvedR(wrapper.webhookUserId, userId, automation.id),
            clearPendingConfirmationR(
              wrapper.webhookUserId,
              userId,
              automation.id,
            ),
          ]).catch((err) => {
            logger.debug(
              { userId, automationId: automation.id, error: err.message },
              "Self-healing: Failed to clear old states, but proceeding",
            );
          });
        }

        // 1. Ask-to-follow gate
        const askToFollowEvent = {
          ...(wrapper.event.event as any),
          originEventId: (wrapper.event as any).originEventId || eventId,
        };

        const askRes = await executeAskToFollow(
          askToFollowEvent,
          automation,
          wrapper.accessToken,
          wrapper.webhookUserId,
          wrapper.instagramUsername,
        );

        const resolvedAskRes =
          isOpeningMessageFlow &&
          askRes.ok &&
          askRes.value === "NEEDS_OPENING_MESSAGE"
            ? ok("PROCEED" as const)
            : askRes;

        if (!resolvedAskRes.ok) {
          return {
            automationId: automation.id,
            clerkUserId: wrapper.clerkUserId,
            userId: wrapper.userId,
            webhookUserId: wrapper.webhookUserId,
            eventId,
            status: "FAILED",
            errorMessage: resolvedAskRes.error.message,
            actionType: automation.actionType,
            commentData: wrapper.event.event,
            dbReserved: wrapper.dbReserved,
          } as ExecutionOutcome;
        }

        if (resolvedAskRes.value === "HALT") {
          if (userId)
            await setPendingConfirmationR(
              wrapper.webhookUserId,
              userId,
              automation.id,
            );

          if (wrapper.event.type === "COMMENT") {
            await executePublicReply(
              wrapper.event.event as any,
              automation,
              wrapper.accessToken,
              wrapper.webhookUserId,
            ).catch((err) => {
              logger.warn(
                { error: err.message, automationId: automation.id },
                "Failed to send public reply during follow gate",
              );
            });
          }

          return {
            automationId: automation.id,
            clerkUserId: wrapper.clerkUserId,
            userId: wrapper.userId,
            webhookUserId: wrapper.webhookUserId,
            eventId,
            status: "ASK_TO_FOLLOW_SENT",
            actionType: automation.actionType,
            commentData: wrapper.event.event,
            dbReserved: wrapper.dbReserved,
          } as ExecutionOutcome;
        }

        if (resolvedAskRes.value === "NEEDS_OPENING_MESSAGE") {
          if (wrapper.event.type === "STORY_REPLY") {
            // Bypass
          } else {
            const openRes = await executeOpeningMessage(
              wrapper.event.event as any,
              automation,
              wrapper.accessToken,
              wrapper.webhookUserId,
            );

            if (openRes.ok && userId) {
              await Promise.all([
                setPendingConfirmationR(
                  wrapper.webhookUserId,
                  userId,
                  automation.id,
                ),
                setAccountSpamGuardR(wrapper.webhookUserId, 2),
              ]).catch(() => {});
            }

            if (wrapper.event.type === "COMMENT") {
              await executePublicReply(
                wrapper.event.event as any,
                automation,
                wrapper.accessToken,
                wrapper.webhookUserId,
              ).catch((err) => {
                logger.warn(
                  { error: err.message, automationId: automation.id },
                  "Failed to send public reply during opening message gate",
                );
              });
            }

            return {
              automationId: automation.id,
              clerkUserId: wrapper.clerkUserId,
              userId: wrapper.userId,
              webhookUserId: wrapper.webhookUserId,
              eventId,
              status: openRes.ok ? "OPENING_MESSAGE_SENT" : "FAILED",
              errorMessage: openRes.ok ? undefined : openRes.error.message,
              actionType: automation.actionType,
              commentData: wrapper.event.event,
              dbReserved: wrapper.dbReserved,
            } as ExecutionOutcome;
          }
        }

        // 2. DM Delivery FIRST
        const dmRes = await executeDmDelivery(
          wrapper.event.event as any,
          automation,
          wrapper.accessToken,
          wrapper.webhookUserId,
        );

        if (!dmRes.ok) {
          return {
            automationId: automation.id,
            clerkUserId: wrapper.clerkUserId,
            userId: wrapper.userId,
            webhookUserId: wrapper.webhookUserId,
            eventId,
            status: "FAILED",
            errorMessage: dmRes.error.message,
            actionType: automation.actionType,
            commentData: wrapper.event.event,
            dbReserved: wrapper.dbReserved,
          } as ExecutionOutcome;
        }

        const isDelivered =
          dmRes.value.sentMessage || dmRes.value.instagramMessageId;

        // 3. Public Reply ONLY if DM was delivered (and it is a COMMENT)
        let replyRes: Result<any, any> = ok(null);
        if (isDelivered && wrapper.event.type === "COMMENT") {
          replyRes = await executePublicReply(
            wrapper.event.event as any,
            automation,
            wrapper.accessToken,
            wrapper.webhookUserId,
          );
        }

        if (isDelivered) {
          if (userId) {
            await setUserCooldownR(
              wrapper.webhookUserId,
              userId,
              automation.id,
            );
            if (isFollowConfirmFlow || isOpeningMessageFlow) {
              await Promise.all([
                setAskResolvedR(wrapper.webhookUserId, userId, automation.id),
                clearPendingConfirmationR(
                  wrapper.webhookUserId,
                  userId,
                  automation.id,
                ),
                setAccountSpamGuardR(wrapper.webhookUserId, 2),
              ]).catch(() => {});
            } else {
              await setAccountSpamGuardR(wrapper.webhookUserId, 2).catch(
                () => {},
              );
            }
          }

          if (!replyRes.ok) {
            logger.warn(
              {
                userId,
                automationId: automation.id,
                error: replyRes.error.message,
              },
              "Partial Success: DM delivered, but Public Reply failed.",
            );
          }

          return {
            automationId: automation.id,
            clerkUserId: wrapper.clerkUserId,
            userId: wrapper.userId,
            webhookUserId: wrapper.webhookUserId,
            eventId,
            status: "SUCCESS",
            actionType: automation.actionType,
            commentData: wrapper.event.event,
            sentMessage: dmRes.value.sentMessage,
            instagramMessageId: dmRes.value.instagramMessageId,
            errorMessage: !replyRes.ok ? replyRes.error.message : undefined,
            dbReserved: wrapper.dbReserved,
          } as ExecutionOutcome;
        }

        return {
          automationId: automation.id,
          clerkUserId: wrapper.clerkUserId,
          userId: wrapper.userId,
          webhookUserId: wrapper.webhookUserId,
          eventId,
          status: "SKIPPED",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
          sentMessage: dmRes.value.sentMessage,
          instagramMessageId: dmRes.value.instagramMessageId,
          dbReserved: wrapper.dbReserved,
        } as ExecutionOutcome;
      } catch (err: any) {
        logger.error(
          { automationId: automation.id, eventId, error: err.message },
          "Unexpected error in runExecutionFlow automation loop",
        );
        return {
          automationId: automation.id,
          clerkUserId: wrapper.clerkUserId,
          userId: wrapper.userId,
          webhookUserId: wrapper.webhookUserId,
          eventId,
          status: "FAILED",
          errorMessage: err.message || "Unknown automation error",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
          dbReserved: wrapper.dbReserved,
        } as ExecutionOutcome;
      }
    }),
  );

  const automationOutcomes: ExecutionOutcome[] = [];
  automationResults.forEach((res, index) => {
    const automation = wrapper.safeAutomations[index];
    if (res.status === "fulfilled") {
      automationOutcomes.push(res.value as ExecutionOutcome);
    } else {
      logger.error(
        { error: res.reason, eventId, automationId: automation.id },
        "Individual automation implementation threw/rejected. Recording as failure.",
      );
      automationOutcomes.push({
        automationId: automation.id,
        clerkUserId: wrapper.clerkUserId,
        userId: wrapper.userId,
        webhookUserId: wrapper.webhookUserId,
        eventId,
        status: "FAILED",
        errorMessage: String(res.reason || "Automation promise rejected"),
        actionType: automation.actionType,
        commentData: wrapper.event.event,
        dbReserved: wrapper.dbReserved,
      } as ExecutionOutcome);
    }
  });

  return automationOutcomes;
}

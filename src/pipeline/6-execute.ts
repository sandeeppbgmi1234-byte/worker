import { ExecutionOutcome, GuardedEvent } from "../types";
import { ExecutionError } from "../errors/pipeline.errors";
import { executeDmDelivery } from "../branches/dm-delivery";
import { executeAskToFollow } from "../branches/ask-to-follow";
import { executeOpeningMessage } from "../branches/opening-message";
import { Result, ok } from "../helpers/result";
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

      // --- CRITICAL-2: ACQUIRE PER-USER-PER-ACCOUNT EXECUTION LOCK (30s) ---
      if (userId) {
        const lockKey = `lock:execute:account:${wrapper.accountId}:user:${userId}`;
        const redis = getRedisClient();
        if (redis) {
          const lockToken = Math.random().toString(36).substring(2, 15);
          const acquired = await redis.set(lockKey, lockToken, "EX", 30, "NX");
          if (acquired !== "OK") {
            logger.info(
              { userId, accountId: wrapper.accountId, eventId },
              "Execution lock held by another thread. Flagging for retry.",
            );
            throw new ExecutionError(
              "executeEvents",
              `Execution lock held for user ${userId} on account ${wrapper.accountId}`,
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

      return runExecutionFlow(
        wrapper,
        eventId,
        userId,
        isFollowConfirmFlow,
        isOpeningMessageFlow,
      );
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

  if (flatOutcomes.length > 0) {
    if (errors.length > 0) {
      logger.warn(
        { errorCount: errors.length },
        "Partial batch failure in execution stage. Propagating successes first.",
      );
    }
    return ok(flatOutcomes);
  }

  if (errors.length > 0) {
    throw errors[0];
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
          } as ExecutionOutcome;
        }
      }

      // 2. Public Reply & DM Delivery in Parallel
      const replyPromise =
        wrapper.event.type === "COMMENT"
          ? executePublicReply(
              wrapper.event.event as any,
              automation,
              wrapper.accessToken,
              wrapper.webhookUserId,
            )
          : Promise.resolve(ok(null));

      const dmPromise = executeDmDelivery(
        wrapper.event.event as any,
        automation,
        wrapper.accessToken,
        wrapper.webhookUserId,
      );

      const [replyRes, dmRes] = await Promise.all([replyPromise, dmPromise]);

      if (dmRes.ok) {
        const isDelivered =
          dmRes.value.sentMessage || dmRes.value.instagramMessageId;

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
        } as ExecutionOutcome;
      }

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
      } as ExecutionOutcome;
    }),
  );

  const automationOutcomes: ExecutionOutcome[] = [];
  for (const res of automationResults) {
    if (res.status === "fulfilled") {
      automationOutcomes.push(res.value);
    } else {
      logger.error(
        { error: res.reason },
        "Individual automation failed during multi-trigger flow.",
      );
    }
  }

  return automationOutcomes;
}

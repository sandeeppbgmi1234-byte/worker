import { GuardedEvent, ExecutionOutcome } from "../types";
import { Result, ok } from "../helpers/result";
import { ExecutionError } from "../errors/pipeline.errors";
import {
  executeAskToFollow,
  executeDmDelivery,
  executePublicReply,
  executeOpeningMessage,
} from "../branches";
import {
  setUserCooldownR,
  setPendingConfirmationR,
  setAskResolvedR,
  clearAskResolvedR,
  clearPendingConfirmationR,
  isPendingConfirmationR,
} from "../redis/operations/cooldown";
import { QUICK_REPLIES } from "../config/instagram.config";
import { logger } from "../logger";

export async function executeEvents(
  guardedEvents: GuardedEvent[],
): Promise<Result<ExecutionOutcome[], ExecutionError>> {
  const executionResults = await Promise.all(
    guardedEvents.map(async (wrapper) => {
      let eventId = "";
      let userId = "";
      switch (wrapper.event.type) {
        case "COMMENT":
          eventId = wrapper.event.event.id;
          userId = wrapper.event.event.userId;
          break;
        case "STORY_REPLY":
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

      // Perform execution for each automation in parallel
      const automationOutcomes = await Promise.all(
        wrapper.safeAutomations.map(async (automation) => {
          // 0. SELF-HEALING: Clean slate for new threads
          if (
            (wrapper.event.type === "COMMENT" ||
              wrapper.event.type === "STORY_REPLY") &&
            userId
          ) {
            await Promise.all([
              clearAskResolvedR(userId, automation.id),
              clearPendingConfirmationR(userId, automation.id),
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
            originEventId:
              wrapper.event.type === "QUICK_REPLY"
                ? wrapper.event.originEventId
                : undefined,
          };

          const askRes = await executeAskToFollow(
            askToFollowEvent,
            automation,
            wrapper.accessToken,
            wrapper.event.instagramUserId,
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
              eventId,
              status: "FAILED",
              errorMessage: resolvedAskRes.error.message,
              actionType: automation.actionType,
              commentData: wrapper.event.event,
            } as ExecutionOutcome;
          }

          if (resolvedAskRes.value === "HALT") {
            if (userId) await setPendingConfirmationR(userId, automation.id);
            return {
              automationId: automation.id,
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
                wrapper.event.instagramUserId,
              );

              if (openRes.ok && userId)
                await setPendingConfirmationR(userId, automation.id);

              return {
                automationId: automation.id,
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
                  wrapper.event.instagramUserId,
                )
              : Promise.resolve(ok(null));

          const dmPromise = executeDmDelivery(
            wrapper.event.event as any,
            automation,
            wrapper.accessToken,
            wrapper.event.instagramUserId,
          );

          const [replyRes, dmRes] = await Promise.all([
            replyPromise,
            dmPromise,
          ]);

          if (!replyRes.ok) {
            return {
              automationId: automation.id,
              eventId,
              status: "FAILED",
              errorMessage: replyRes.error.message,
              actionType: automation.actionType,
              commentData: wrapper.event.event,
            } as ExecutionOutcome;
          }

          if (dmRes.ok) {
            const isDelivered =
              dmRes.value.sentMessage || dmRes.value.instagramMessageId;

            if (isDelivered) {
              if (userId) {
                await setUserCooldownR(userId, automation.id);
                if (isFollowConfirmFlow || isOpeningMessageFlow) {
                  await Promise.all([
                    setAskResolvedR(userId, automation.id),
                    clearPendingConfirmationR(userId, automation.id),
                  ]).catch(() => {});
                }
              }

              return {
                automationId: automation.id,
                eventId,
                status: "SUCCESS",
                actionType: automation.actionType,
                commentData: wrapper.event.event,
                sentMessage: dmRes.value.sentMessage,
                instagramMessageId: dmRes.value.instagramMessageId,
              } as ExecutionOutcome;
            }

            return {
              automationId: automation.id,
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
            eventId,
            status: "FAILED",
            errorMessage: dmRes.error.message,
            actionType: automation.actionType,
            commentData: wrapper.event.event,
          } as ExecutionOutcome;
        }),
      );

      return automationOutcomes;
    }),
  );

  const flatOutcomes = executionResults.flat();
  return ok(flatOutcomes);
}

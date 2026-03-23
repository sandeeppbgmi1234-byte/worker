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
} from "../redis/operations/cooldown";

export async function executeEvents(
  guardedEvents: GuardedEvent[],
): Promise<Result<ExecutionOutcome[], ExecutionError>> {
  const outcomes: ExecutionOutcome[] = [];

  for (const wrapper of guardedEvents) {
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

    for (const automation of wrapper.safeAutomations) {
      // 1. Ask to follow gate
      const askRes = await executeAskToFollow(
        wrapper.event.event as any,
        automation,
        wrapper.accessToken,
        wrapper.event.instagramUserId,
        wrapper.instagramUsername,
      );

      if (!askRes.ok) {
        outcomes.push({
          automationId: automation.id,
          eventId,
          status: "FAILED",
          errorMessage: askRes.error.message,
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
        continue;
      }

      if (askRes.value === "HALT") {
        outcomes.push({
          automationId: automation.id,
          eventId,
          status: "ASK_TO_FOLLOW_SENT",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
        if (userId) await setPendingConfirmationR(userId, automation.id);
        break; // Stop further automations for this trigger if gated
      }

      if (askRes.value === "NEEDS_OPENING_MESSAGE") {
        if (wrapper.event.type === "STORY_REPLY") {
          // User already opened 24h window by replying directly. Treat as PROCEED.
        } else {
          // Send Opening Message for comments
          const openRes = await executeOpeningMessage(
            wrapper.event.event as any,
            automation,
            wrapper.accessToken,
            wrapper.event.instagramUserId,
          );

          outcomes.push({
            automationId: automation.id,
            eventId,
            status: openRes.ok ? "OPENING_MESSAGE_SENT" : "FAILED",
            errorMessage: openRes.ok ? undefined : openRes.error.message,
            actionType: automation.actionType,
            commentData: wrapper.event.event,
          });
          if (openRes.ok && userId)
            await setPendingConfirmationR(userId, automation.id);
          break; // Stop automation here, wait for postback
        }
      }

      // 2. Public Reply (ONLY for comment flow)
      // Note: This uses comment_id recipient to send the text notification DM as well.
      let publicReplySuccess = true;
      if (wrapper.event.type === "COMMENT") {
        const replyRes = await executePublicReply(
          wrapper.event.event as any,
          automation,
          wrapper.accessToken,
          wrapper.event.instagramUserId,
        );
        if (!replyRes.ok) {
          publicReplySuccess = false;
          outcomes.push({
            automationId: automation.id,
            eventId,
            status: "FAILED",
            errorMessage: replyRes.error.message,
            actionType: automation.actionType,
            commentData: wrapper.event.event,
          });
        }
      }

      if (!publicReplySuccess) continue;

      // 3. DM Delivery (Template via IGSID)
      const dmRes = await executeDmDelivery(
        wrapper.event.event as any,
        automation,
        wrapper.accessToken,
        wrapper.event.instagramUserId,
      );

      if (dmRes.ok) {
        outcomes.push({
          automationId: automation.id,
          eventId,
          status: "SUCCESS",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
          sentMessage: dmRes.value.sentMessage,
          instagramMessageId: dmRes.value.instagramMessageId,
        });
        if (userId) await setUserCooldownR(userId, automation.id);
        continue;
      }

      // Handle DM Failure
      outcomes.push({
        automationId: automation.id,
        eventId,
        status: "FAILED",
        errorMessage: dmRes.error.message,
        actionType: automation.actionType,
        commentData: wrapper.event.event,
      });
    }
  }

  return ok(outcomes);
}

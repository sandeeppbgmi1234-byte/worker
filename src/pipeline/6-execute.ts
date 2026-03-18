import { GuardedEvent, ExecutionOutcome } from "../types";
import { Result, ok } from "../helpers/result";
import { ExecutionError } from "../errors/pipeline.errors";
import {
  executeAskToFollow,
  executeDmDelivery,
  executePublicReply,
} from "@/branches";

export async function executeEvents(
  guardedEvents: GuardedEvent[],
): Promise<Result<ExecutionOutcome[], ExecutionError>> {
  const outcomes: ExecutionOutcome[] = [];

  for (const wrapper of guardedEvents) {
    let eventId = "";
    switch (wrapper.event.type) {
      case "COMMENT":
        eventId = wrapper.event.event.id;
        break;
      case "STORY_REPLY":
      case "QUICK_REPLY":
        eventId = wrapper.event.event.messageId;
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
        break; // Stop further automations for this trigger if gated
      }

      // 2. Public Reply (if comment flow)
      let publicReplySuccess = true;
      switch (wrapper.event.type) {
        case "COMMENT": {
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
          break;
        }
      }

      if (!publicReplySuccess) continue;

      // 3. DM Delivery
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

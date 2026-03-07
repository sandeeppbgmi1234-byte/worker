import { GuardedEvent, ExecutionOutcome } from "../types";
import { Result, ok } from "../helpers/result";
import { ExecutionError } from "../errors/pipeline.errors";
import { executePublicReply } from "../branches/public-reply.ts";
import { executeAskToFollow } from "../branches/ask-to-follow.ts";
import { executeDmDelivery } from "../branches/dm-delivery.ts";

export async function executeEvents(
  guardedEvents: GuardedEvent[],
): Promise<Result<ExecutionOutcome[], ExecutionError>> {
  const outcomes: ExecutionOutcome[] = [];

  for (const wrapper of guardedEvents) {
    for (const automation of wrapper.safeAutomations) {
      // 1. Public Reply (if comment flow)
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
            eventId: wrapper.event.event.id,
            status: "FAILED",
            errorMessage: replyRes.error.message,
            actionType: automation.actionType,
            commentData: wrapper.event.event,
          });
        }
      }

      if (!publicReplySuccess) continue;

      // 2. Ask to follow
      const askRes = await executeAskToFollow(
        wrapper.event.event as any,
        automation,
        wrapper.accessToken,
        wrapper.event.instagramUserId,
      );
      if (askRes.ok && askRes.value === "HALT") {
        outcomes.push({
          automationId: automation.id,
          eventId:
            wrapper.event.type === "COMMENT"
              ? wrapper.event.event.id
              : wrapper.event.event.messageId,
          status: "ASK_TO_FOLLOW_SENT",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
        continue;
      } else if (!askRes.ok) {
        outcomes.push({
          automationId: automation.id,
          eventId:
            wrapper.event.type === "COMMENT"
              ? wrapper.event.event.id
              : wrapper.event.event.messageId,
          status: "FAILED",
          errorMessage: askRes.error.message,
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
        continue;
      }

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
          eventId:
            wrapper.event.type === "COMMENT"
              ? wrapper.event.event.id
              : wrapper.event.event.messageId,
          status: "SUCCESS",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
          sentMessage: dmRes.value.sentMessage,
          instagramMessageId: dmRes.value.instagramMessageId,
        });
      } else {
        outcomes.push({
          automationId: automation.id,
          eventId:
            wrapper.event.type === "COMMENT"
              ? wrapper.event.event.id
              : wrapper.event.event.messageId,
          status: "FAILED",
          errorMessage: dmRes.error.message,
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
      }
    }

    if (wrapper.event.type === "QUICK_REPLY") {
      // Just do DM delivery directly since it bypassed standard execution
      await executeDmDelivery(
        wrapper.event.event as any,
        wrapper.safeAutomations[0],
        wrapper.accessToken,
        wrapper.event.instagramUserId,
        true,
      );
    }
  }

  return ok(outcomes);
}

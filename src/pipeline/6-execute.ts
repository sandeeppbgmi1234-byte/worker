import { GuardedEvent, ExecutionOutcome } from "../types";
import { Result, ok } from "../helpers/result";
import { ExecutionError } from "../errors/pipeline.errors";
import { executePublicReply } from "../branches/public-reply.ts";
import { executeAskToFollow } from "../branches/ask-to-follow.ts";
import { executeDmDelivery } from "../branches/dm-delivery.ts";
import { QUICK_REPLIES } from "../config/instagram.config";

export async function executeEvents(
  guardedEvents: GuardedEvent[],
): Promise<Result<ExecutionOutcome[], ExecutionError>> {
  const outcomes: ExecutionOutcome[] = [];

  for (const wrapper of guardedEvents) {
    const eventId =
      wrapper.event.type === "COMMENT"
        ? wrapper.event.event.id
        : wrapper.event.type === "STORY_REPLY" ||
            wrapper.event.type === "QUICK_REPLY"
          ? wrapper.event.event.messageId
          : "";

    for (const automation of wrapper.safeAutomations) {
      // 1. Ask to follow
      const askRes = await executeAskToFollow(
        wrapper.event.event as any,
        automation,
        wrapper.accessToken,
        wrapper.event.instagramUserId,
        wrapper.instagramUsername,
      );
      if (askRes.ok && askRes.value === "HALT") {
        outcomes.push({
          automationId: automation.id,
          eventId,
          status: "ASK_TO_FOLLOW_SENT",
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
        continue;
      } else if (!askRes.ok) {
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

      // 2. Public Reply (if comment flow)
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
      } else {
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

    if (
      wrapper.event.type === "QUICK_REPLY" &&
      wrapper.event.payload.startsWith(QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX)
    ) {
      // Direct delivery for bypass payloads (already follow checked or story flow)
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

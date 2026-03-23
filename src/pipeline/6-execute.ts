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
} from "../redis/operations/cooldown";
import { QUICK_REPLIES } from "../config/instagram.config";

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

    // Determine if this is a follow-gate button interaction (for routing decisions below)
    const qrPayload =
      wrapper.event.type === "QUICK_REPLY" ? wrapper.event.payload : "";
    const isFollowConfirmFlow = qrPayload.startsWith(
      QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX,
    );
    const isOpeningMessageFlow = qrPayload.startsWith(
      QUICK_REPLIES.OPENING_MESSAGE.PAYLOAD_PREFIX,
    );

    for (const automation of wrapper.safeAutomations) {
      // Each new comment or story reply starts a fresh thread.
      // Clear any leftover RESOLVED / PENDING state from a previous thread
      // so the user gets a clean experience without the guard blocking them.
      if (
        (wrapper.event.type === "COMMENT" ||
          wrapper.event.type === "STORY_REPLY") &&
        userId
      ) {
        await clearAskResolvedR(userId, automation.id).catch(() => {});
        await clearPendingConfirmationR(userId, automation.id).catch(() => {});
      }

      // 1. Ask-to-follow gate
      const askRes = await executeAskToFollow(
        wrapper.event.event as any,
        automation,
        wrapper.accessToken,
        wrapper.event.instagramUserId,
        wrapper.instagramUsername,
      );

      // Special case: user just clicked the consent button (OPENING_MESSAGE_CLICK).
      // If the Graph API follower-check still returns a "User consent" error
      // (Meta's backend hasn't propagated the consent yet — a known race condition),
      // treat it as PROCEED rather than re-sending the opening message card.
      // This breaks the infinite consent loop.
      const resolvedAskRes =
        isOpeningMessageFlow &&
        askRes.ok &&
        askRes.value === "NEEDS_OPENING_MESSAGE"
          ? ok("PROCEED" as const)
          : askRes;

      if (!resolvedAskRes.ok) {
        outcomes.push({
          automationId: automation.id,
          eventId,
          status: "FAILED",
          errorMessage: resolvedAskRes.error.message,
          actionType: automation.actionType,
          commentData: wrapper.event.event,
        });
        continue;
      }

      if (resolvedAskRes.value === "HALT") {
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

      if (resolvedAskRes.value === "NEEDS_OPENING_MESSAGE") {
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
        const isDelivered =
          dmRes.value.sentMessage || dmRes.value.instagramMessageId;

        if (isDelivered) {
          outcomes.push({
            automationId: automation.id,
            eventId,
            status: "SUCCESS",
            actionType: automation.actionType,
            commentData: wrapper.event.event,
            sentMessage: dmRes.value.sentMessage,
            instagramMessageId: dmRes.value.instagramMessageId,
          });

          if (userId) {
            // Honour the production comment-spam cooldown (only when env flag is on).
            // This is unrelated to the ask-to-follow gate.
            await setUserCooldownR(userId, automation.id);

            // If this delivery completed an ask-to-follow thread (consent or follow confirm),
            // mark the thread RESOLVED and clear the pending flag.
            // From this point on, every further button tap is permanently dropped by the guard.
            if (isFollowConfirmFlow || isOpeningMessageFlow) {
              await setAskResolvedR(userId, automation.id);
              await clearPendingConfirmationR(userId, automation.id);
            }
          }
        } else {
          outcomes.push({
            automationId: automation.id,
            eventId,
            status: "SKIPPED",
            actionType: automation.actionType,
            commentData: wrapper.event.event,
            sentMessage: dmRes.value.sentMessage,
            instagramMessageId: dmRes.value.instagramMessageId,
          });
        }
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

import { EnrichedEvent, GuardedEvent } from "../types";
import { isCommentProcessedR } from "../redis/operations/comment";
import {
  isUserOnCooldownR,
  isUserThrottledR,
  isPendingConfirmationR,
  isEventThrottledR,
  isAskResolvedR,
} from "../redis/operations/cooldown";
import { QUICK_REPLIES } from "../config/instagram.config";
import { Result, ok } from "../helpers/result";
import { GuardError } from "../errors/pipeline.errors";

export async function guardEvents(
  enrichedEvents: EnrichedEvent[],
): Promise<Result<GuardedEvent[], GuardError>> {
  const guardedEvents: GuardedEvent[] = [];

  for (const wrapper of enrichedEvents) {
    const safeAutomations = [];
    let userId = "";

    switch (wrapper.event.type) {
      case "COMMENT":
        userId = wrapper.event.event.userId;
        break;
      case "STORY_REPLY":
      case "QUICK_REPLY":
        userId = wrapper.event.event.senderId;
        break;
      default:
        break;
    }

    for (const automation of wrapper.matchedAutomations) {
      if (userId) {
        // --- ATOMICITY & SPAM PROTECTION ---

        if (wrapper.event.type === "QUICK_REPLY") {
          const payload = wrapper.event.payload;
          const isFollowConfirmClick = payload.startsWith(
            QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX,
          );
          const isOpeningMessageClick = payload.startsWith(
            QUICK_REPLIES.OPENING_MESSAGE.PAYLOAD_PREFIX,
          );

          if (isFollowConfirmClick || isOpeningMessageClick) {
            // Thread already resolved? Drop permanently — no more button clicks entertained.
            const resolved = await isAskResolvedR(userId, automation.id);
            if (resolved) continue;

            // Per-user+automation throttle: prevents button spam within a 10s window.
            // This works because Meta issues a NEW unique messageId per button tap,
            // making an event-level throttle completely ineffective for postback spam.
            const throttled = await isUserThrottledR(userId, automation.id);
            if (throttled) continue;
          } else {
            // BYPASS and other QRs use per-event throttle (correct for those flows)
            const eventId = wrapper.event.event.messageId;
            const throttled = await isEventThrottledR(eventId);
            if (throttled) continue;
          }
        } else {
          // For new triggers (Comments), we lock based on User + Automation ID.
          // This prevents someone from commenting the same trigger 10 times to flood.
          const throttled = await isUserThrottledR(userId, automation.id);
          if (throttled) continue;
        }

        const onCooldown = await isUserOnCooldownR(userId, automation.id);
        if (onCooldown) continue;

        // Prevent overlapping gates (waiting for follow/consent click)
        // SELF-HEALING: We only block if the event is NOT a fresh trigger (e.g. another button click).
        // Fresh triggers (Comments/Story Replies) should always be allowed to pre-empt an old stuck state.
        const pending = await isPendingConfirmationR(userId, automation.id);
        if (
          pending &&
          wrapper.event.type !== "QUICK_REPLY" &&
          wrapper.event.type !== "COMMENT" &&
          wrapper.event.type !== "STORY_REPLY"
        ) {
          continue;
        }
      }

      safeAutomations.push(automation);
    }

    if (safeAutomations.length > 0 || wrapper.event.type === "QUICK_REPLY") {
      guardedEvents.push({ ...wrapper, safeAutomations });
    }
  }

  return ok(guardedEvents);
}

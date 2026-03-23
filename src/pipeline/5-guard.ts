import { EnrichedEvent, GuardedEvent } from "../types";
import { isCommentProcessedR } from "../redis/operations/comment";
import {
  isUserOnCooldownR,
  isUserThrottledR,
  isPendingConfirmationR,
  isEventThrottledR,
} from "../redis/operations/cooldown";
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
          // For button clicks, we lock based on the UNIQUE message ID.
          // This allows users to click the button immediately after a comment (bypassing user lock)
          // but prevents them from spamming the EXACT same button 10 times in 1s.
          const eventId = wrapper.event.event.messageId;
          const throttled = await isEventThrottledR(eventId);
          if (throttled) continue;
        } else {
          // For new triggers (Comments), we lock based on User + Automation ID.
          // This prevents someone from commenting the same trigger 10 times to flood.
          const throttled = await isUserThrottledR(userId, automation.id);
          if (throttled) continue;
        }

        const onCooldown = await isUserOnCooldownR(userId, automation.id);
        if (onCooldown) continue;

        // Prevent overlapping gates (waiting for follow/consent click)
        const pending = await isPendingConfirmationR(userId, automation.id);
        if (pending && wrapper.event.type !== "QUICK_REPLY") continue;
      }

      safeAutomations.push(automation);
    }

    if (safeAutomations.length > 0 || wrapper.event.type === "QUICK_REPLY") {
      guardedEvents.push({ ...wrapper, safeAutomations });
    }
  }

  return ok(guardedEvents);
}

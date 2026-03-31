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
import { Automation } from "@prisma/client";

export async function guardEvents(
  enrichedEvents: EnrichedEvent[],
): Promise<Result<GuardedEvent[], GuardError>> {
  const guardResults = await Promise.all(
    enrichedEvents.map(async (wrapper) => {
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

      if (!userId) return null;

      const automationGuards = await Promise.all(
        wrapper.matchedAutomations.map(async (automation) => {
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
              const resolved = await isAskResolvedR(userId, automation.id);
              if (resolved) return null;

              const throttled = await isUserThrottledR(userId, automation.id);
              if (throttled) return null;
            } else {
              const eventId = (wrapper.event.event as any).messageId || "";
              const throttled = await isEventThrottledR(eventId);
              if (throttled) return null;
            }
          } else {
            const throttled = await isUserThrottledR(userId, automation.id);
            if (throttled) return null;
          }

          // Combined check for cooldown and pending states
          const [onCooldown, pending] = await Promise.all([
            isUserOnCooldownR(userId, automation.id),
            isPendingConfirmationR(userId, automation.id),
          ]);

          if (onCooldown) return null;

          // SELF-HEALING: Block new triggers while a user has a pending interaction (e.g., Follow Gate).
          // We let QUICK_REPLY through so the user can resolve the state.
          if (
            pending &&
            (wrapper.event.type === "COMMENT" ||
              wrapper.event.type === "STORY_REPLY")
          ) {
            return null;
          }

          return automation;
        }),
      );

      const validAutomations = automationGuards.filter(
        (a): a is Automation => a !== null,
      );

      if (validAutomations.length > 0 || wrapper.event.type === "QUICK_REPLY") {
        return {
          ...wrapper,
          safeAutomations: validAutomations,
        } as GuardedEvent;
      }
      return null;
    }),
  );

  const guardedEvents = guardResults.filter(
    (item): item is GuardedEvent => item !== null,
  );
  return ok(guardedEvents);
}

import { EnrichedEvent, GuardedEvent } from "../types";
import { isCommentProcessedR } from "../redis/operations/comment";
import { isUserOnCooldownR } from "../redis/operations/cooldown";
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
        const onCooldown = await isUserOnCooldownR(userId, automation.id);
        if (onCooldown) continue;
      }

      safeAutomations.push(automation);
    }

    if (safeAutomations.length > 0 || wrapper.event.type === "QUICK_REPLY") {
      guardedEvents.push({ ...wrapper, safeAutomations });
    }
  }

  return ok(guardedEvents);
}

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

    let eventId = "";
    let userId = "";

    if (wrapper.event.type === "COMMENT") {
      eventId = wrapper.event.event.id;
      userId = wrapper.event.event.userId;
    } else if (
      wrapper.event.type === "STORY_REPLY" ||
      wrapper.event.type === "QUICK_REPLY"
    ) {
      eventId = wrapper.event.event.messageId;
      userId = wrapper.event.event.senderId;
    }

    for (const automation of wrapper.matchedAutomations) {
      if (eventId) {
        const alreadyProcessed = await isCommentProcessedR(
          eventId,
          automation.id,
        );
        if (alreadyProcessed) continue;
      }

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

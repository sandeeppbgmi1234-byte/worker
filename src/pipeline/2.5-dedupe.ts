import { RefinedEvent } from "../types";
import { acquireEventLockR, isEventHandledR } from "../redis/operations/event";
import { Result, ok } from "../helpers/result";
import { GuardError } from "../errors/pipeline.errors";

/**
 * Early-exit Guard: Checks if the event ID has already been seen by the system.
 * If Meta retries the webhook delivery, the eventId (commentId/messageId) remains the same.
 */
export async function dedupeEvents(
  events: RefinedEvent[],
): Promise<Result<RefinedEvent[], GuardError>> {
  const uniqueEvents: RefinedEvent[] = [];

  for (const eventWrapper of events) {
    let eventId = "";

    switch (eventWrapper.type) {
      case "COMMENT":
        eventId = eventWrapper.event.id;
        break;
      case "STORY_REPLY":
      case "DM_MESSAGE":
      case "QUICK_REPLY":
        eventId = eventWrapper.event.messageId;
        break;
      default:
        break;
    }

    if (eventId) {
      // 1. Check Permanent Handled Mark
      const alreadyHandled = await isEventHandledR(
        eventWrapper.instagramUserId,
        eventId,
      );
      if (alreadyHandled) continue;

      // 2. Acquire Soft Processing Lock
      const lockRes = await acquireEventLockR(
        eventWrapper.instagramUserId,
        eventId,
      );
      if (lockRes === "LOCKED") continue;
      if (lockRes === "ERROR") {
        throw new GuardError(
          "dedupeEvents",
          `Redis error acquiring lock: ${eventId}`,
        );
      }
    }

    uniqueEvents.push(eventWrapper);
  }

  return ok(uniqueEvents);
}

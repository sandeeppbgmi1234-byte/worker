import { RefinedEvent } from "../types";
import { isEventHandledR } from "../redis/operations/event";
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
      case "QUICK_REPLY":
        eventId = eventWrapper.event.messageId;
        break;
      default:
        break;
    }

    if (eventId) {
      const alreadyHandled = await isEventHandledR(eventId);
      if (alreadyHandled) {
        // Log event as duplicate and skip
        continue;
      }
    }

    uniqueEvents.push(eventWrapper);
  }

  return ok(uniqueEvents);
}

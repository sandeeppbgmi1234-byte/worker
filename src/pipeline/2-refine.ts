import { WebhookEntry, RefinedEvent } from "../types";
import { Result, ok } from "../helpers/result";
import { RefinementError } from "../errors/pipeline.errors";
import { processCommentChanges } from "./refine/comments";
import { processMessagingEntry } from "./refine/messaging";

export function refineEntries(
  entries: WebhookEntry[],
): Result<RefinedEvent[], RefinementError> {
  const events: RefinedEvent[] = [];

  for (const entry of entries) {
    const instagramUserId = entry.id;

    // We use a switch statement to delegate processing based on the entry's field presence
    // In Meta webhooks, entries typically contain either 'changes' or 'messaging'
    for (const key of Object.keys(entry)) {
      switch (key) {
        case "changes":
          events.push(...processCommentChanges(entry, instagramUserId));
          break;
        case "messaging":
          events.push(...processMessagingEntry(entry, instagramUserId));
          break;
        default:
          // Other fields like 'id' or 'time' are not processed as events
          break;
      }
    }
  }

  return ok(events);
}

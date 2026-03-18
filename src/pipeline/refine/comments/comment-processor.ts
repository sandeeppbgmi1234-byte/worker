import { WebhookEntry, RefinedEvent } from "../../../types";
import {
  sanitizeCommentText,
  sanitizeUsername,
  sanitizeText,
} from "../../../helpers/sanitize";

export function processCommentChanges(
  entry: WebhookEntry,
  instagramUserId: string,
): RefinedEvent[] {
  const events: RefinedEvent[] = [];

  if (!entry.changes) return events;

  for (const change of entry.changes) {
    if (change.field === "comments") {
      const commentData = change.value;

      // 1. Noise Filter: Skips self-comments to prevent infinite automation loops
      if (commentData.from?.self_ig_scoped_id) continue;

      const timestamp = commentData.timestamp || entry.time;
      const mediaId = commentData.media?.id || commentData.media_id;

      if (
        !commentData.id ||
        !commentData.text ||
        !commentData.from?.id ||
        !commentData.from?.username ||
        !timestamp ||
        !mediaId
      ) {
        continue; // Skip silently inside batch if malformed
      }

      events.push({
        type: "COMMENT",
        webhookId: entry.id,
        time: entry.time,
        instagramUserId,
        event: {
          id: commentData.id,
          text: sanitizeCommentText(commentData.text),
          username: sanitizeUsername(commentData.from.username),
          userId: sanitizeText(String(commentData.from.id), 100),
          timestamp: String(timestamp),
          mediaId,
        },
      });
    }
  }

  return events;
}

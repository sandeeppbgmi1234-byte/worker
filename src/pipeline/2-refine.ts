import {
  WebhookEntry,
  ValidatedComment,
  ValidatedStoryReply,
  RefinedEvent,
} from "../types";
import {
  sanitizeCommentText,
  sanitizeUsername,
  sanitizeText,
} from "../helpers/sanitize";
import { Result, ok } from "../helpers/result";
import { RefinementError } from "../errors/pipeline.errors";
import { QUICK_REPLIES } from "../config/instagram.config";

export function refineEntries(
  entries: WebhookEntry[],
): Result<RefinedEvent[], RefinementError> {
  const events: RefinedEvent[] = [];

  for (const entry of entries) {
    const instagramUserId = entry.id;

    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === "comments") {
          const commentData = change.value;
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
            continue; // Skip silently inside batch
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
    }

    if (entry.messaging) {
      for (const msg of entry.messaging) {
        if (msg.message?.reply_to?.story) {
          if (!msg.sender?.id || !msg.message.text || !msg.message.mid)
            continue;

          events.push({
            type: "STORY_REPLY",
            webhookId: entry.id,
            time: entry.time,
            instagramUserId,
            event: {
              messageId: msg.message.mid,
              text: msg.message.text,
              senderId: msg.sender.id,
              storyId: msg.message.reply_to.story.id,
              timestamp: String(msg.timestamp),
            },
          });
        }

        const qrPayload = msg.message?.quick_reply?.payload;
        if (qrPayload?.startsWith(QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX)) {
          events.push({
            type: "QUICK_REPLY",
            webhookId: entry.id,
            time: entry.time,
            instagramUserId,
            payload: qrPayload,
            event: msg,
          });
        }
      }
    }
  }

  return ok(events);
}

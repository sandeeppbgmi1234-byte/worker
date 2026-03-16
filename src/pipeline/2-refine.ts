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
    }

    if (entry.messaging) {
      for (const msg of entry.messaging) {
        // 2. Noise Filter: Skips self-sent 'echo' DMs
        if (msg.message?.is_echo) continue;

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

        const qrPayload =
          msg.message?.quick_reply?.payload || msg.postback?.payload;
        if (
          qrPayload?.startsWith(QUICK_REPLIES.BYPASS.PAYLOAD_PREFIX) ||
          qrPayload?.startsWith(QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX) ||
          qrPayload?.startsWith(QUICK_REPLIES.FOLLOW_CONSENT.PAYLOAD_PREFIX)
        ) {
          events.push({
            type: "QUICK_REPLY",
            webhookId: entry.id,
            time: entry.time,
            instagramUserId,
            payload: qrPayload,
            event: {
              messageId:
                msg.message?.mid || msg.postback?.mid || `pb_${msg.timestamp}`,
              text: msg.message?.text || msg.postback?.title || "Quick Reply",
              senderId: msg.sender.id,
              timestamp: String(msg.timestamp),
            },
          });
        }
      }
    }
  }

  return ok(events);
}

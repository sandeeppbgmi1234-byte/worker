import { WebhookEntry, RefinedEvent } from "../../../types";
import { QUICK_REPLIES } from "../../../config/instagram.config";

export function processMessagingEntry(
  entry: WebhookEntry,
  instagramUserId: string,
): RefinedEvent[] {
  const events: RefinedEvent[] = [];
  if (!entry.messaging) return events;

  for (const msg of entry.messaging) {
    // 2. Noise Filter: Skips self-sent 'echo' DMs
    if (msg.message?.is_echo) continue;

    // Process Story Reply
    if (msg.message?.reply_to?.story) {
      if (msg.sender?.id && msg.message.text && msg.message.mid) {
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
    }

    // Process Quick Reply / Postback
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

  return events;
}

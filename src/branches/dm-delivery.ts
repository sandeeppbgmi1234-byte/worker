import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { QUICK_REPLIES } from "../config/instagram.config";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";

export async function executeDmDelivery(
  event: any,
  automation: any,
  accessToken: string,
  instagramUserId: string,
  isQuickReplyBypass: boolean = false,
): Promise<
  Result<{ sentMessage: string; instagramMessageId: string | null }, BaseError>
> {
  const recipientId = event.userId || event.senderId;
  let sentMessage = automation.replyMessage || "";
  let messageId = null;

  const dmCallCount =
    (automation.replyImage ? 1 : 0) + (automation.replyMessage ? 1 : 0);
  if (dmCallCount === 0 && !isQuickReplyBypass)
    return ok({ sentMessage: "", instagramMessageId: null });

  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, dmCallCount);

  const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);

  if (automation.replyImage) {
    const attachmentBody: any = {
      recipient:
        event.id && automation.triggerType !== "STORY_REPLY"
          ? { comment_id: event.id }
          : { id: recipientId },
      message: {
        attachments: [
          { type: "image", payload: { url: automation.replyImage } },
        ],
      },
      messaging_type: "RESPONSE",
      access_token: accessToken,
    };

    const attachResult = await fetchFromInstagram<any>(msgUrl.toString(), {
      method: "POST",
      body: attachmentBody,
      instagramUserId,
      retries: 0,
    });

    if (!attachResult.ok) return fail(attachResult.error);

    if (automation.triggerType === "STORY_REPLY" && !isQuickReplyBypass) {
      return ok({
        sentMessage: "Image Delivery Sent",
        instagramMessageId: attachResult.value?.message_id,
      });
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  if (automation.replyMessage && !isQuickReplyBypass) {
    const textBody: any = {
      recipient:
        event.id && automation.triggerType !== "STORY_REPLY"
          ? { comment_id: event.id }
          : { id: recipientId },
      message: { text: automation.replyMessage },
      messaging_type: "RESPONSE",
      access_token: accessToken,
    };

    const txtResult = await fetchFromInstagram<any>(msgUrl.toString(), {
      method: "POST",
      body: textBody,
      instagramUserId,
      retries: 0,
    });

    if (!txtResult.ok) return fail(txtResult.error);
    messageId = txtResult.value?.message_id;
  }

  return ok({
    sentMessage: automation.replyMessage,
    instagramMessageId: messageId,
  });
}

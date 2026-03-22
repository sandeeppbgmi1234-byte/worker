import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";
import { Automation } from "@prisma/client";

export async function executeDmDelivery(
  event: any,
  automation: Automation,
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
    (automation.replyImage ? 1 : 0) +
    (automation.replyMessage ? 1 : 0) +
    (automation.dmLinks && automation.dmLinks.length > 0 ? 1 : 0);

  if (dmCallCount === 0 && !isQuickReplyBypass)
    return ok({ sentMessage: "", instagramMessageId: null });

  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, dmCallCount);

  const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);

  // 1. Send Image if present
  if (automation.replyImage) {
    const attachmentBody: any = {
      recipient:
        event.id && automation.triggerType !== "STORY_REPLY"
          ? { comment_id: event.id }
          : { id: recipientId },
      message: {
        attachment: {
          type: "image",
          payload: { url: automation.replyImage },
        },
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
      if (!automation.replyMessage && !automation.dmLinks?.length) {
        return ok({
          sentMessage: "Image Delivery Sent",
          instagramMessageId: attachResult.value?.message_id,
        });
      }
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  // 2. Send Text Message if present
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

    if (automation.dmLinks && automation.dmLinks.length > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // 3. Send Links as Generic Template if present (Standard Instagram Link Buttons)
  if (
    automation.dmLinks &&
    automation.dmLinks.length > 0 &&
    !isQuickReplyBypass
  ) {
    const templateBody: any = {
      recipient:
        event.id && automation.triggerType !== "STORY_REPLY"
          ? { comment_id: event.id }
          : { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [
              {
                title: "Quick Links",
                buttons: automation.dmLinks.slice(0, 3).map((link) => ({
                  type: "web_url",
                  url: link.url,
                  title: link.title,
                })),
              },
            ],
          },
        },
      },
      messaging_type: "RESPONSE",
      access_token: accessToken,
    };

    const linksResult = await fetchFromInstagram<any>(msgUrl.toString(), {
      method: "POST",
      body: templateBody,
      instagramUserId,
      retries: 0,
    });

    if (!linksResult.ok) return fail(linksResult.error);
    // If text message wasn't sent, use this message ID
    if (!messageId) messageId = linksResult.value?.message_id;
  }

  return ok({
    sentMessage: automation.replyMessage || "Links sent",
    instagramMessageId: messageId,
  });
}

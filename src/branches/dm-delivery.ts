import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";
import { buildDmReplyTemplate } from "../templates";
import type { Automation } from "@prisma/client";

interface DmDeliveryEvent {
  id?: string; // comment ID (only present for COMMENT triggers)
  userId?: string; // commenter IG scoped ID
  senderId?: string; // sender IG scoped ID (for story/messaging)
}

interface DmDeliveryResult {
  sentMessage: string;
  instagramMessageId: string | null;
}

export async function executeDmDelivery(
  event: DmDeliveryEvent,
  automation: Automation,
  accessToken: string,
  instagramUserId: string,
  isQuickReplyBypass: boolean = false,
): Promise<Result<DmDeliveryResult, BaseError>> {
  const hasContent =
    automation.replyImage ||
    automation.replyMessage ||
    (automation.dmLinks && automation.dmLinks.length > 0);

  if (!hasContent && !isQuickReplyBypass) {
    return ok({ sentMessage: "", instagramMessageId: null });
  }

  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, 1); // Always 1 now

  // Reverting to `comment_id` for COMMENT triggers because `recipient.id`
  // enforces the strict 24-hour window, while `comment_id` allows the 7-day Private Reply window.
  // Even though Meta docs don't explicitly show templates with comment_id, it is supported.
  const recipientId = event.userId || event.senderId;
  const recipient =
    event.id && automation.triggerType !== "STORY_REPLY"
      ? { comment_id: event.id }
      : { id: recipientId! };

  const templateAttachment = buildDmReplyTemplate({
    replyMessage: automation.replyMessage,
    replyImage: automation.replyImage ?? null,
    dmLinks: automation.dmLinks ?? [],
  });

  const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);

  const body = {
    recipient,
    message: { attachment: templateAttachment },
    messaging_type: "RESPONSE" as const,
    access_token: accessToken,
  };

  const result = await fetchFromInstagram<{ message_id?: string }>(
    msgUrl.toString(),
    {
      method: "POST",
      body,
      instagramUserId,
      retries: 0,
    },
  );

  if (!result.ok) return fail(result.error);

  return ok({
    sentMessage: automation.replyMessage || "Template sent",
    instagramMessageId: result.value?.message_id ?? null,
  });
}

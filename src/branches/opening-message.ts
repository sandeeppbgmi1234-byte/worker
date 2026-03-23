import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
import { clearUserCooldownR } from "../redis/operations/cooldown";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";
import { buildOpeningMessageTemplate } from "../templates";
import type { Automation } from "@prisma/client";

interface OpeningMessageEvent {
  id?: string;
  userId?: string;
  senderId?: string;
}

export async function executeOpeningMessage(
  event: OpeningMessageEvent,
  automation: Automation,
  accessToken: string,
  instagramUserId: string,
): Promise<Result<"SENT", BaseError>> {
  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, 1);

  // Reverting to `comment_id` for COMMENT triggers because `recipient.id`
  // enforces the strict 24-hour window, while `comment_id` allows the 7-day Private Reply window.
  // Even though Meta docs don't explicitly show templates with comment_id, it is supported.
  const recipientId = event.userId || event.senderId;
  const recipient = event.id ? { comment_id: event.id } : { id: recipientId! };

  const templateAttachment = buildOpeningMessageTemplate({
    openingMessage: automation.openingMessage ?? null,
    openingButtonText: automation.openingButtonText ?? null,
    automationId: automation.id,
  });

  const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);

  const result = await fetchFromInstagram<unknown>(msgUrl.toString(), {
    method: "POST",
    body: {
      recipient,
      message: { attachment: templateAttachment },
      messaging_type: "RESPONSE" as const,
      access_token: accessToken,
    },
    timeoutMs: 15000,
    retries: 0,
    instagramUserId,
  });

  if (!result.ok) return fail(result.error);

  const commenterId = event.userId || event.senderId;
  if (commenterId) {
    await clearUserCooldownR(commenterId, automation.id).catch(() => {});
  }

  return ok("SENT");
}

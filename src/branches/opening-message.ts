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

  // ALWAYS use recipient.id (IGSID) for template sends — Meta docs require it.
  const recipientId = event.userId || event.senderId;
  const recipient = { id: recipientId! };

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

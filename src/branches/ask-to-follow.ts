import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
import { clearUserCooldownR } from "../redis/operations/cooldown";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";

export async function executeAskToFollow(
  event: any,
  automation: any,
  accessToken: string,
  instagramUserId: string,
): Promise<Result<"PROCEED" | "HALT", BaseError>> {
  if (!automation.askToFollowEnabled) return ok("PROCEED");

  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, 1);

  const commenterId = event.userId || event.senderId;
  const url = buildGraphApiUrl(commenterId);
  url.searchParams.set("fields", "is_user_follow_business");
  url.searchParams.set("access_token", accessToken);

  const followerRes = await fetchFromInstagram<any>(url.toString(), {
    method: "GET",
    instagramUserId,
  });

  if (!followerRes.ok) return ok("PROCEED");

  const isFollowing = followerRes.value?.is_user_follow_business === true;

  if (!isFollowing) {
    const askMessage = [
      automation.askToFollowMessage ||
        "Please follow us first and then comment again!",
      automation.askToFollowLink ? `\n${automation.askToFollowLink}` : "",
    ]
      .join("")
      .trim();

    await checkRateLimits(instagramUserId);
    await incrementApiUsage(instagramUserId, 1);

    const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);
    const result = await fetchFromInstagram<any>(msgUrl.toString(), {
      method: "POST",
      body: {
        recipient: { id: commenterId },
        message: { text: askMessage },
        messaging_type: "RESPONSE",
        access_token: accessToken,
      },
      timeoutMs: 20000,
      retries: 2,
      instagramUserId,
    });

    if (!result.ok) return fail(result.error);

    await clearUserCooldownR(commenterId, automation.id).catch(() => {});

    return ok("HALT");
  }

  return ok("PROCEED");
}

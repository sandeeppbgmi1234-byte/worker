import { QUICK_REPLIES } from "../config/instagram.config";
import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
import { clearUserCooldownR } from "../redis/operations/cooldown";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl, ENDPOINTS } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";

export async function executeAskToFollow(
  event: any,
  automation: any,
  accessToken: string,
  instagramUserId: string,
  instagramUsername: string,
): Promise<Result<"PROCEED" | "HALT", BaseError>> {
  if (!automation.askToFollowEnabled) return ok("PROCEED");

  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, 1);

  // If this is a follow confirmation click, give Meta a moment to update status
  const isConfirmation = event.text === QUICK_REPLIES.FOLLOW_CONFIRM.TITLE;
  if (isConfirmation) {
    await new Promise((r) => setTimeout(r, 1500));
  }

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
    const defaultMessage =
      "Oh no! It seems you're not following me 👀 It would really mean a lot if you visit my profile and hit the follow button 😇. Once you have done that, click on the 'I'm following' button below and you will get the link ✨.";
    const askMessage = automation.askToFollowMessage || defaultMessage;
    const profileUrl =
      automation.askToFollowLink ||
      `https://www.instagram.com/${instagramUsername}`;

    await checkRateLimits(instagramUserId);
    await incrementApiUsage(instagramUserId, 1);

    const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);
    const result = await fetchFromInstagram<any>(msgUrl.toString(), {
      method: "POST",
      body: {
        recipient: event.id ? { comment_id: event.id } : { id: commenterId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "generic",
              elements: [
                {
                  title: "Follow me first! 🔒",
                  subtitle: askMessage,
                  buttons: [
                    {
                      type: "web_url",
                      url: profileUrl,
                      title: "Visit Profile",
                    },
                    {
                      type: "postback",
                      title: QUICK_REPLIES.FOLLOW_CONFIRM.TITLE,
                      payload: `${QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX}${automation.id}`,
                    },
                  ],
                },
              ],
            },
          },
        },
        messaging_type: "RESPONSE",
        access_token: accessToken,
      },
      timeoutMs: 15000,
      retries: 0, // No retries for DM cards to avoid duplicates
      instagramUserId,
    });

    if (!result.ok) return fail(result.error);

    // 2. Public Reply (if comment flow)
    if (event.id) {
      const replyUrl = buildGraphApiUrl(ENDPOINTS.REPLY_COMMENT(event.id));
      await fetchFromInstagram<any>(replyUrl.toString(), {
        method: "POST",
        body: {
          message:
            "Check your DMs! Please follow us first to get the content. 🚀",
          access_token: accessToken,
        },
        instagramUserId,
        retries: 0,
      }).catch(() => {});
    }

    await clearUserCooldownR(commenterId, automation.id).catch(() => {});

    return ok("HALT");
  }

  return ok("PROCEED");
}

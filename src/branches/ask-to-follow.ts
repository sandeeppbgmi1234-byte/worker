import { QUICK_REPLIES } from "../config/instagram.config";
import {
  checkRateLimits,
  incrementApiUsage,
  isFollowWarningSentR,
  setFollowWarningSentR,
} from "../redis";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";
import { buildAskToFollowTemplate } from "../templates";

interface AskToFollowEvent {
  id?: string;
  userId?: string;
  senderId?: string;
  text?: string;
  originEventId?: string;
}

export async function executeAskToFollow(
  event: AskToFollowEvent,
  automation: any,
  accessToken: string,
  instagramUserId: string,
  instagramUsername: string,
): Promise<Result<"PROCEED" | "HALT" | "NEEDS_OPENING_MESSAGE", BaseError>> {
  if (!automation.askToFollowEnabled) return ok("PROCEED");

  await checkRateLimits(instagramUserId);
  await incrementApiUsage(instagramUserId, 1);

  // If this is a follow confirmation click, give Meta a moment to update status
  const isConfirmation = event.text === QUICK_REPLIES.FOLLOW_CONFIRM.TITLE;
  if (isConfirmation) {
    await new Promise((r) => setTimeout(r, 1500));
  }

  const commenterId = event.userId || event.senderId;
  const originEventId = event.originEventId || event.id || "unknown";

  const url = buildGraphApiUrl(commenterId!);
  url.searchParams.set("fields", "is_user_follow_business");
  url.searchParams.set("access_token", accessToken);

  const followerRes = await fetchFromInstagram<any>(url.toString(), {
    method: "GET",
    instagramUserId,
  });

  if (!followerRes.ok) {
    if (followerRes.error.message.includes("User consent")) {
      return ok("NEEDS_OPENING_MESSAGE");
    }
    return fail(followerRes.error);
  }

  const isFollowing = followerRes.value?.is_user_follow_business === true;

  if (!isFollowing) {
    const recipient = event.id
      ? { comment_id: event.id }
      : { id: commenterId! };
    const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);

    // Case 1: They clicked "I am Following" but are still not following
    if (isConfirmation) {
      const alreadyWarned = await isFollowWarningSentR(
        instagramUserId,
        commenterId!,
        automation.id,
      );
      if (alreadyWarned) return ok("HALT");

      await checkRateLimits(instagramUserId);
      await incrementApiUsage(instagramUserId, 1);

      const reminderText =
        "Please follow to access the link 🔔. This reminder will appear only 1 time ⏳. Once you have followed, click ‘I am Following’ above to continue ✅";

      const res = await fetchFromInstagram<any>(msgUrl.toString(), {
        method: "POST",
        body: {
          recipient: { id: commenterId! },
          message: { text: reminderText },
          messaging_type: "RESPONSE" as const,
          access_token: accessToken,
        },
        instagramUserId,
      });

      if (res.ok) {
        await setFollowWarningSentR(
          instagramUserId,
          commenterId!,
          automation.id,
        );
      }
      return ok("HALT");
    }

    // Case 2: Initial Trigger - send the Template card
    const profileUrl =
      automation.askToFollowLink ||
      `https://www.instagram.com/${instagramUsername}`;

    await checkRateLimits(instagramUserId);
    await incrementApiUsage(instagramUserId, 1);

    const templateAttachment = buildAskToFollowTemplate(
      {
        askToFollowMessage: automation.askToFollowMessage ?? null,
        profileUrl,
      },
      automation.id,
    );

    const result = await fetchFromInstagram<any>(msgUrl.toString(), {
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
    return ok("HALT");
  }

  return ok("PROCEED");
}

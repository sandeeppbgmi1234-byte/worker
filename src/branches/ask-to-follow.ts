import { QUICK_REPLIES } from "../config/instagram.config";
import {
  isFollowWarningSentR,
  setFollowWarningSentR,
} from "../redis/operations/cooldown";
import {
  checkRateLimits,
  incrementApiUsage,
} from "../redis/operations/rate-limit";
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
    // If this is a button click ("I'm following") and they STILL haven't followed,
    // we give them ONE warning (re-resend the card). If they spam after that, we HALT.
    if (isConfirmation) {
      const alreadyWarned = await isFollowWarningSentR(
        commenterId!,
        automation.id,
      );
      if (alreadyWarned) return ok("HALT");

      await setFollowWarningSentR(commenterId!, automation.id);
    }

    const profileUrl =
      automation.askToFollowLink ||
      `https://www.instagram.com/${instagramUsername}`;

    await checkRateLimits(instagramUserId);
    await incrementApiUsage(instagramUserId, 1);

    // Reverting to `comment_id` for COMMENT triggers because `recipient.id`
    // enforces the strict 24-hour window, while `comment_id` allows the 7-day Private Reply window.
    // Even though Meta docs don't explicitly show templates with comment_id, it is supported.
    const recipient = event.id
      ? { comment_id: event.id }
      : { id: commenterId! };

    const templateAttachment = buildAskToFollowTemplate(
      {
        askToFollowMessage: automation.askToFollowMessage ?? null,
        profileUrl,
      },
      automation.id,
    );

    const msgUrl = buildGraphApiUrl(`${instagramUserId}/messages`);
    const result = await fetchFromInstagram<any>(msgUrl.toString(), {
      method: "POST",
      body: {
        recipient,
        message: { attachment: templateAttachment },
        messaging_type: "RESPONSE" as const,
        access_token: accessToken,
      },
      timeoutMs: 15000,
      retries: 0, // No retries for DM cards to avoid duplicates
      instagramUserId,
    });

    if (!result.ok) return fail(result.error);
    return ok("HALT");
  }

  return ok("PROCEED");
}

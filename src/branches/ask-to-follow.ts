import { QUICK_REPLIES, MESSAGING_DEFAULTS } from "../config/instagram.config";
import { checkRateLimits, acquireFollowWarningFlagR } from "../redis";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";
import { buildAskToFollowTemplate } from "../templates";
import { sanitizeUsername } from "../helpers/sanitize";

interface AskToFollowEvent {
  id?: string;
  userId?: string;
  senderId?: string;
  text?: string;
  username?: string;
  originEventId?: string;
}

export async function executeAskToFollow(
  event: AskToFollowEvent,
  automation: any,
  accessToken: string,
  webhookUserId: string,
  instagramUsername: string,
): Promise<
  Result<
    { status: "PROCEED" | "HALT" | "NEEDS_OPENING_MESSAGE"; username?: string },
    BaseError
  >
> {
  const needsUsername = !event.username;
  const gateEnabled = automation.askToFollowEnabled;

  if (!gateEnabled && !needsUsername) {
    return ok({ status: "PROCEED", username: event.username });
  }

  // If gate is disabled but we have no username, we continue to the fetch logic
  // but we won't HALT at the end if the user is not following.

  await checkRateLimits(webhookUserId);

  // If this is a follow confirmation click, give Meta a moment to update status
  const isConfirmation = event.text === QUICK_REPLIES.FOLLOW_CONFIRM.TITLE;
  if (isConfirmation) {
    await new Promise((r) => setTimeout(r, 1500));
  }

  const commenterId = event.userId || event.senderId;
  const originEventId = event.originEventId || event.id || "unknown";

  const url = buildGraphApiUrl(commenterId!);
  url.searchParams.set("fields", "is_user_follow_business,username");
  url.searchParams.set("access_token", accessToken);

  const followerRes = await fetchFromInstagram<any>(url.toString(), {
    method: "GET",
    webhookUserId: webhookUserId,
  });

  if (!followerRes.ok) {
    if (followerRes.error.message.includes("User consent")) {
      return ok({ status: "NEEDS_OPENING_MESSAGE", username: undefined });
    }
    return fail(followerRes.error);
  }

  const isFollowing = followerRes.value?.is_user_follow_business === true;
  const username = followerRes.value?.username
    ? sanitizeUsername(followerRes.value.username)
    : undefined;

  if (!isFollowing) {
    if (!gateEnabled) return ok({ status: "PROCEED", username });

    const recipient = event.id
      ? { comment_id: event.id }
      : { id: commenterId! };
    const msgUrl = buildGraphApiUrl(`${webhookUserId}/messages`);

    // Case 1: They clicked "I am Following" but are still not following
    if (isConfirmation) {
      const acquired = await acquireFollowWarningFlagR(
        webhookUserId,
        commenterId!,
        automation.id,
      );
      if (!acquired) return ok({ status: "HALT", username });

      await checkRateLimits(webhookUserId);

      const reminderText =
        automation.askToFollowReminder || MESSAGING_DEFAULTS.FOLLOW_REMINDER;

      const res = await fetchFromInstagram<any>(msgUrl.toString(), {
        method: "POST",
        body: {
          recipient,
          message: { text: reminderText },
          messaging_type: "RESPONSE" as const,
          access_token: accessToken,
        },
        webhookUserId: webhookUserId,
      });

      if (!res.ok) return fail(res.error);

      return ok({ status: "HALT", username });
    }

    // Case 2: Initial Trigger - send the Template card
    const profileUrl =
      automation.askToFollowLink ||
      `https://www.instagram.com/${instagramUsername}`;

    await checkRateLimits(webhookUserId);

    const templateAttachment = buildAskToFollowTemplate(
      {
        askToFollowMessage: automation.askToFollowMessage ?? null,
        profileUrl,
      },
      automation.id,
      originEventId,
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
      webhookUserId: webhookUserId,
    });

    if (!result.ok) return fail(result.error);
    return ok({ status: "HALT", username });
  }

  return ok({ status: "PROCEED", username });
}

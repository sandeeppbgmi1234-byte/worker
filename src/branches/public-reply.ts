import { checkRateLimits } from "../redis/operations/rate-limit";
import { Result, ok, fail } from "../helpers/result";
import { BaseError } from "../errors/base.error";
import { buildGraphApiUrl, ENDPOINTS } from "../instagram/endpoints";
import { fetchFromInstagram } from "../instagram/gateway";
import { Automation } from "@prisma/client";
import { CommentData } from "@/types";

export async function executePublicReply(
  comment: CommentData,
  automation: Automation,
  accessToken: string,
  instagramUserId: string,
): Promise<Result<void, BaseError>> {
  if (
    automation.actionType === "DM" &&
    automation.commentReplyWhenDm &&
    automation.commentReplyWhenDm.length > 0
  ) {
    await checkRateLimits(instagramUserId);

    const pickedReply =
      automation.commentReplyWhenDm[
        Math.floor(Math.random() * automation.commentReplyWhenDm.length)
      ];

    const url = buildGraphApiUrl(ENDPOINTS.REPLY_COMMENT(comment.id));

    const result = await fetchFromInstagram<any>(url.toString(), {
      method: "POST",
      body: { message: pickedReply, access_token: accessToken },
      timeoutMs: 20000,
      retries: 2,
      webhookUserId: instagramUserId,
    });

    if (!result.ok) return fail(result.error);
  }
  return ok(undefined);
}

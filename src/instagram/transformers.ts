export function transformMessageResponse(raw: any): { messageId: string } {
  return { messageId: raw.message_id };
}

export function transformReplyResponse(raw: any): { replyId: string } {
  return { replyId: raw.id };
}

export function transformFollowerResponse(raw: any): { isFollowing: boolean } {
  if (
    raw === undefined ||
    raw === null ||
    !("is_user_follow_business" in raw)
  ) {
    return { isFollowing: false };
  }
  return { isFollowing: raw.is_user_follow_business === true };
}

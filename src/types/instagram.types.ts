export interface RefreshTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface QuickReply {
  title: string;
  payload: string;
}

export interface SendMessageOptions {
  recipientId: string;
  commentId?: string;
  message?: string;
  attachmentUrl?: string;
  quickReplies?: QuickReply[];
  accessToken: string;
  messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG";
  tag?: string;
  instagramUserId?: string;
}

export interface ReplyToCommentOptions {
  commentId: string;
  message: string;
  accessToken: string;
  instagramUserId?: string;
}

export interface FollowerCheckResult {
  isFollowing: boolean;
}

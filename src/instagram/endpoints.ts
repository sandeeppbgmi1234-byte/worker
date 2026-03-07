import { GRAPH_API } from "../config/instagram.config";

export function buildGraphApiUrl(endpoint: string): URL {
  return new URL(`${GRAPH_API.BASE_URL}/${GRAPH_API.VERSION}/${endpoint}`);
}

export const ENDPOINTS = {
  USER_MEDIA: (userId: string) => `${userId}/media`,
  POST_COMMENTS: (postId: string) => `${postId}/comments`,
  USER_INFO: (userId: string) => `${userId}`,
  SEND_MESSAGE: (igUserId: string) => `${igUserId}/messages`,
  REPLY_COMMENT: (commentId: string) => `${commentId}/replies`,
  CHECK_FOLLOWER: (commenterId: string) => `${commenterId}`,
} as const;

import { WORKER_CONFIG } from "../config/worker.config";

export const MAX_LENGTHS = {
  USERNAME: 30,
  COMMENT_TEXT: 2200,
} as const;

export function sanitizeText(text: string, maxLength?: number): string {
  if (typeof text !== "string") return "";
  let sanitized = text.trim();
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

export function sanitizeUsername(username: string): string {
  if (typeof username !== "string") return "unknown";
  let sanitized = username.trim();
  sanitized = sanitized.replace(/<[^>]*>/g, "");
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");
  if (sanitized.length > MAX_LENGTHS.USERNAME) {
    sanitized = sanitized.substring(0, MAX_LENGTHS.USERNAME);
  }
  if (sanitized.length === 0) return "unknown";
  return sanitized;
}

export function sanitizeCommentText(text: string): string {
  if (typeof text !== "string" || !text) return "";
  return sanitizeText(text, MAX_LENGTHS.COMMENT_TEXT);
}

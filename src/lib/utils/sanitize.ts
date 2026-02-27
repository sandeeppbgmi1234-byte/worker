/**
 * Input Sanitization Utilities
 * Provides functions to sanitize and validate user-generated content
 */

/**
 * Maximum length constants for different input types
 */
export const MAX_LENGTHS = {
  USERNAME: 30, // Instagram username limit
  COMMENT_TEXT: 2200, // Instagram comment limit
} as const;

/**
 * Sanitizes text for use in plain text contexts (like Instagram messages)
 * Removes or escapes control characters and dangerous sequences
 */
export function sanitizeText(text: string, maxLength?: number): string {
  if (typeof text !== "string") {
    return "";
  }

  // Trims whitespace
  let sanitized = text.trim();

  // Removes null bytes and other control characters (except newlines and tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  // Removes zero-width characters that could be used for obfuscation
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Limits length if specified
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Sanitizes a username string
 * Removes dangerous characters and validates length
 */
export function sanitizeUsername(username: string): string {
  if (typeof username !== "string") {
    return "unknown";
  }

  // Removes HTML tags and special characters
  let sanitized = username.trim();

  // Removes HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, "");

  // Removes control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");

  // Limits to Instagram username max length
  if (sanitized.length > MAX_LENGTHS.USERNAME) {
    sanitized = sanitized.substring(0, MAX_LENGTHS.USERNAME);
  }

  // Ensures username is not empty
  if (sanitized.length === 0) {
    return "unknown";
  }

  return sanitized;
}

/**
 * Sanitizes comment text from Instagram
 * Handles external, untrusted input from Instagram API
 */
export function sanitizeCommentText(text: string): string {
  if (typeof text !== "string" || !text) {
    return "";
  }

  // Sanitizes text and limits length
  return sanitizeText(text, MAX_LENGTHS.COMMENT_TEXT);
}

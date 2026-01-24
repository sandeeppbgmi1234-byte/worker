/**
 * Input Sanitization Utilities
 * Provides functions to sanitize and validate user-generated content
 */

/**
 * Maximum length constants for different input types
 */
export const MAX_LENGTHS = {
  REPLY_MESSAGE: 1000, // Instagram message limit
  TRIGGER: 200, // Individual trigger keyword
  POST_CAPTION: 2200, // Instagram caption limit
  USERNAME: 30, // Instagram username limit
  COMMENT_TEXT: 2200, // Instagram comment limit
  TRIGGERS_ARRAY: 50, // Maximum number of triggers
} as const;

/**
 * Escapes HTML special characters to prevent XSS attacks
 * Converts potentially dangerous characters to their HTML entity equivalents
 */
export function escapeHtml(text: string): string {
  if (typeof text !== "string") {
    return "";
  }

  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
  };

  return text.replace(/[&<>"'/]/g, (char) => htmlEscapes[char] || char);
}

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

/**
 * Sanitizes a reply message
 * Ensures message is safe for sending via Instagram API
 */
export function sanitizeReplyMessage(message: string): string {
  if (typeof message !== "string") {
    return "";
  }

  // Sanitizes and limits to Instagram message max length
  return sanitizeText(message, MAX_LENGTHS.REPLY_MESSAGE);
}

/**
 * Sanitizes a trigger keyword
 * Validates and sanitizes individual trigger strings
 */
export function sanitizeTrigger(trigger: string): string {
  if (typeof trigger !== "string") {
    return "";
  }

  // Trims and sanitizes
  let sanitized = trigger.trim();

  // Removes HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, "");

  // Removes control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");

  // Limits length
  if (sanitized.length > MAX_LENGTHS.TRIGGER) {
    sanitized = sanitized.substring(0, MAX_LENGTHS.TRIGGER);
  }

  return sanitized;
}

/**
 * Sanitizes an array of triggers
 * Validates array length and sanitizes each trigger
 */
export function sanitizeTriggers(triggers: string[]): string[] {
  if (!Array.isArray(triggers)) {
    return [];
  }

  // Limits array size
  const limitedTriggers = triggers.slice(0, MAX_LENGTHS.TRIGGERS_ARRAY);

  // Sanitizes each trigger and filters out empty ones
  return limitedTriggers
    .map((trigger) => sanitizeTrigger(trigger))
    .filter((trigger) => trigger.length > 0);
}

/**
 * Sanitizes post caption
 * Handles optional post caption text
 */
export function sanitizePostCaption(caption: string | undefined | null): string | null {
  if (!caption || typeof caption !== "string") {
    return null;
  }

  // Sanitizes and limits length
  const sanitized = sanitizeText(caption, MAX_LENGTHS.POST_CAPTION);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Validates that a string is within acceptable length
 */
export function validateLength(
  text: string,
  min: number,
  max: number
): { valid: boolean; error?: string } {
  if (typeof text !== "string") {
    return { valid: false, error: "Input must be a string" };
  }

  if (text.length < min) {
    return {
      valid: false,
      error: `Input must be at least ${min} characters long`,
    };
  }

  if (text.length > max) {
    return {
      valid: false,
      error: `Input must be no more than ${max} characters long`,
    };
  }

  return { valid: true };
}

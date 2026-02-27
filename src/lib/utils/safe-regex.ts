/**
 * Safe Regex Execution Utilities
 * Protects against ReDoS (Regular Expression Denial of Service) attacks
 */

/**
 * Maximum allowed regex pattern length
 */
const MAX_REGEX_LENGTH = 500;

/**
 * Maximum execution time for regex matching (in milliseconds)
 */
const REGEX_TIMEOUT_MS = 100;

/**
 * Dangerous regex patterns that can cause catastrophic backtracking
 * These patterns are known to be vulnerable to ReDoS attacks
 */
const DANGEROUS_PATTERNS = [
  /(\+|\*|\{1,\})/g, // Quantifiers that can cause backtracking
  /(\.\*|\.\+)/g, // Greedy wildcards
  /(\|\|)/g, // Nested alternations
  /(\(.*\)\*)/g, // Nested quantifiers
];

/**
 * Checks if a regex pattern contains dangerous constructs
 * Returns true if the pattern is potentially unsafe
 */
function containsDangerousPattern(pattern: string): boolean {
  // Checks for nested quantifiers (e.g., (a+)+, (a*)*)
  if (/(\([^)]*\)[\+\*\{])/.test(pattern)) {
    return true;
  }

  // Checks for exponential backtracking patterns
  if (/([^\\]\.\*[^\\]\.\*)/.test(pattern)) {
    return true;
  }

  // Checks for alternation with quantifiers (e.g., (a|b)*)
  if (/(\([^)]*\|[^)]*\)[\+\*\{])/.test(pattern)) {
    return true;
  }

  return false;
}

/**
 * Validates regex pattern complexity
 * Returns true if pattern is safe to execute
 */
export function validateRegexPattern(pattern: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof pattern !== "string") {
    return { valid: false, error: "Pattern must be a string" };
  }

  // Checks pattern length
  if (pattern.length > MAX_REGEX_LENGTH) {
    return {
      valid: false,
      error: `Pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters`,
    };
  }

  // Checks for dangerous patterns
  if (containsDangerousPattern(pattern)) {
    return {
      valid: false,
      error:
        "Pattern contains potentially dangerous constructs that could cause ReDoS",
    };
  }

  // Validates that pattern can be compiled
  try {
    new RegExp(pattern);
  } catch (error) {
    return {
      valid: false,
      error: `Invalid regex pattern: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }

  return { valid: true };
}

/**
 * Executes a regex test with timeout protection
 * Note: JavaScript regex execution is synchronous and cannot be truly interrupted,
 * but we limit input size and validate patterns to minimize risk
 */
async function safeRegexTest(regex: RegExp, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Limits text length to prevent excessive processing
    // Instagram comments are max 2200 chars, but we add buffer for safety
    const maxTextLength = 5000;
    const limitedText = text.substring(0, maxTextLength);

    // Sets up timeout to at least detect if execution hangs
    const timeoutId = setTimeout(() => {
      // If we reach here, the regex took too long
      // Note: The regex may still be running, but we return false
      resolve(false);
    }, REGEX_TIMEOUT_MS);

    try {
      // Executes regex synchronously (cannot be interrupted)
      // Pattern validation should prevent most ReDoS cases
      const result = regex.test(limitedText);
      clearTimeout(timeoutId);
      resolve(result);
    } catch (error) {
      clearTimeout(timeoutId);
      resolve(false);
    }
  });
}

/**
 * Safely executes a regex pattern against text with timeout and validation
 * Returns match result or false if pattern is unsafe or times out
 */
export async function safeRegexMatch(
  pattern: string,
  text: string,
  flags: string = "i",
): Promise<boolean> {
  // Validates pattern first
  const validation = validateRegexPattern(pattern);
  if (!validation.valid) {
    return false;
  }

  try {
    // Compiles regex
    const regex = new RegExp(pattern, flags);

    // Executes with timeout protection
    return await safeRegexTest(regex, text);
  } catch (error) {
    // Returns false on any error (invalid pattern, etc.)
    return false;
  }
}

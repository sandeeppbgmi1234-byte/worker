const MAX_REGEX_LENGTH = 500;
const REGEX_TIMEOUT_MS = 100;

function containsDangerousPattern(pattern: string): boolean {
  if (/(\([^)]*\)[\+\*\{])/.test(pattern)) return true;
  if (/([^\\]\.\*[^\\]\.\*)/.test(pattern)) return true;
  if (/(\([^)]*\|[^)]*\)[\+\*\{])/.test(pattern)) return true;
  return false;
}

export function validateRegexPattern(pattern: string): {
  valid: boolean;
  error?: string;
} {
  if (typeof pattern !== "string")
    return { valid: false, error: "Pattern must be a string" };
  if (pattern.length > MAX_REGEX_LENGTH)
    return { valid: false, error: `Length exceeds ${MAX_REGEX_LENGTH}` };
  if (containsDangerousPattern(pattern))
    return { valid: false, error: "Dangerous constructs" };
  try {
    new RegExp(pattern);
  } catch (error) {
    return { valid: false, error: `Invalid pattern` };
  }
  return { valid: true };
}

async function safeRegexTest(regex: RegExp, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const limitedText = text.substring(0, 5000);
    const timeoutId = setTimeout(() => resolve(false), REGEX_TIMEOUT_MS);
    try {
      const result = regex.test(limitedText);
      clearTimeout(timeoutId);
      resolve(result);
    } catch {
      clearTimeout(timeoutId);
      resolve(false);
    }
  });
}

export async function safeRegexMatch(
  pattern: string,
  text: string,
  flags: string = "i",
): Promise<boolean> {
  const validation = validateRegexPattern(pattern);
  if (!validation.valid) return false;
  try {
    const regex = new RegExp(pattern, flags);
    return await safeRegexTest(regex, text);
  } catch {
    return false;
  }
}

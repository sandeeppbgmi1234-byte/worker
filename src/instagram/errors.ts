import {
  InstagramError,
  InstagramRateLimitError,
  InstagramSpamPolicyError,
  InstagramTokenExpiredError,
} from "@/errors";

export function handleInstagramError(errorData: any, status: number) {
  const message =
    errorData?.error?.message || errorData?.message || `HTTP ${status}`;
  const code = errorData?.error?.code;
  const subcode = errorData?.error?.error_subcode;

  if (status === 429 || code === 4 || code === 17 || code === 32) {
    throw new InstagramRateLimitError("fetchFromInstagram", message, true);
  }
  if (status === 400 || status === 401) {
    if (
      code === 190 ||
      message.toLowerCase().includes("session") ||
      message.toLowerCase().includes("password") ||
      message.toLowerCase().includes("token")
    ) {
      throw new InstagramTokenExpiredError("fetchFromInstagram", message);
    }
  }
  if (status === 400 && message.toLowerCase().includes("spam")) {
    throw new InstagramSpamPolicyError("fetchFromInstagram", message);
  }
  if (status >= 500) {
    throw new InstagramError("fetchFromInstagram", message, status, true);
  }
  throw new InstagramError("fetchFromInstagram", message, status, false);
}

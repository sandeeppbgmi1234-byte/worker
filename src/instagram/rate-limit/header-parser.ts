import { logger } from "../../logger";

export function extractUsageHeaders(response: Response) {
  const appUsageStr = response.headers.get("x-app-usage");
  const businessUsageStr = response.headers.get("x-business-use-case-usage");
  const adUsageStr = response.headers.get("x-ad-account-usage");

  let appUsage: Record<string, any> | null = null;
  let businessUsage: Record<string, any> | null = null;
  let adUsage: Record<string, any> | null = null;

  try {
    if (appUsageStr) appUsage = JSON.parse(appUsageStr);
    if (businessUsageStr) businessUsage = JSON.parse(businessUsageStr);
    if (adUsageStr) adUsage = JSON.parse(adUsageStr);
  } catch (e) {
    logger.warn(
      { appUsageStr, businessUsageStr, adUsageStr },
      "Failed to parse usage headers",
    );
  }

  return { appUsage, businessUsage, adUsage };
}

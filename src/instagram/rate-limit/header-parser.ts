import { logger } from "../../logger";

export function extractUsageHeaders(response: Response) {
  const appUsageStr = response.headers.get("x-app-usage");
  const businessUsageStr = response.headers.get("x-business-use-case-usage");

  let appUsage: Record<string, any> | null = null;
  let businessUsage: Record<string, any> | null = null;

  try {
    if (appUsageStr) appUsage = JSON.parse(appUsageStr);
    if (businessUsageStr) businessUsage = JSON.parse(businessUsageStr);
  } catch (e) {
    logger.warn(
      { appUsageStr, businessUsageStr },
      "Failed to parse usage headers",
    );
  }

  return { appUsage, businessUsage };
}

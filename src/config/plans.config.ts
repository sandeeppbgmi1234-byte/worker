/**
 * Plan Configuration for the worker
 * This should match dmbro-main/src/configs/plans.config.ts
 */

export const PLAN_CREDIT_LIMITS: Record<string, number> = {
  FREE: 1000,
  BASIC: 10000,
  PREMIUM: 25000,
  BLACK: -1,
};

/**
 * Returns the credit limit for a given plan identifier.
 * Defaults to the FREE plan limit if invalid or missing.
 */
export function getCreditLimitForPlan(plan?: string | null): number {
  if (!plan) return PLAN_CREDIT_LIMITS.FREE;
  const normalizedPlan = plan.trim().toUpperCase();
  return PLAN_CREDIT_LIMITS[normalizedPlan] ?? PLAN_CREDIT_LIMITS.FREE;
}

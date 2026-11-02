export const TIER_BREAKPOINTS = { medium: 720, expanded: 1100 } as const;

export type Tier = "compact" | "medium" | "expanded";

export function tierForWidth(width: number): Tier {
  if (width < TIER_BREAKPOINTS.medium) return "compact";
  if (width < TIER_BREAKPOINTS.expanded) return "medium";
  return "expanded";
}

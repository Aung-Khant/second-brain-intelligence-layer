// The confidence cutoffs shared by every matcher (local rules and AI): below
// `suggested` a relation is hidden entirely; at or above `suggested` it shows
// as an unchecked suggestion; at or above `preselected` it's auto-checked.
// classifierConfig.version is stamped onto every classification-log.ts entry
// so past logs can be traced back to the ruleset that produced them.
export const relationshipThresholds = {
  preselected: 90,
  suggested: 75
} as const;

export const classifierConfig = {
  version: "v0-local-rules-2026-08-17",
  maxVisibleTextCharacters: 6000,
  minimumVisibleConfidence: relationshipThresholds.suggested
} as const;

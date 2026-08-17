export const relationshipThresholds = {
  preselected: 90,
  suggested: 75
} as const;

export const classifierConfig = {
  version: "v0-local-rules-2026-08-17",
  maxVisibleTextCharacters: 6000,
  minimumVisibleConfidence: relationshipThresholds.suggested
} as const;

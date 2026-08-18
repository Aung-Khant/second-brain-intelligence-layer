// The core shapes that flow through the classify pipeline: TrustedResourceInput
// (what the extension/CLI sends in) -> ResourceUnderstanding (derived
// summary/concepts) -> ClassifiedResource (+ Area/Topic/Project matches) ->
// IntelligentClassification (+ engine used and any new-Area/Topic
// suggestions). RelationshipState mirrors the confidence thresholds in
// config/classification.ts: preselected = auto-checked, suggested = shown
// but unchecked, hidden = filtered out entirely.
export type ResourceType =
  | "webpage"
  | "article"
  | "youtube_video"
  | "youtube_channel";

export type SaveIntent =
  | "learn"
  | "use_for_project"
  | "research"
  | "reference"
  | "content_inspiration"
  | "explore_later"
  | "other";

export type RelationshipState = "preselected" | "suggested" | "hidden";

export type RelationSuggestion = {
  entityId: string;
  entityName: string;
  confidence: number;
  reason: string;
  state: RelationshipState;
};

export type TrustedResourceInput = {
  url?: string;
  type: ResourceType;
  title: string;
  creator?: string;
  description?: string;
  visibleText?: string;
};

export type ResourceUnderstanding = {
  summary: string;
  concepts: string[];
  keywords: string[];
  subjectMatter: string[];
};

export type ClassifiedResource = ResourceUnderstanding & {
  areas: RelationSuggestion[];
  topics: RelationSuggestion[];
  projects: RelationSuggestion[];
};

export type NewTopicSuggestion = {
  name: string;
  areaId?: string;
  areaName?: string;
  confidence: number;
  reason: string;
};

export type NewAreaSuggestion = {
  name: string;
  confidence: number;
  reason: string;
};

export type CreatedTopic = {
  id: string;
  name: string;
  url: string;
  areaId?: string;
  areaName?: string;
};

export type CreatedArea = {
  id: string;
  name: string;
  url: string;
};

export type IntelligenceEngine = "local" | "openai" | "openrouter";

export type IntelligentClassification = ClassifiedResource & {
  engine: IntelligenceEngine;
  suggestedAreas: NewAreaSuggestion[];
  suggestedTopics: NewTopicSuggestion[];
  suggestedSaveIntent?: SaveIntent;
  suggestedWhySaved?: string;
};

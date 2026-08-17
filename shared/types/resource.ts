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

export type CreatedTopic = {
  id: string;
  name: string;
  url: string;
  areaId?: string;
  areaName?: string;
};

export type IntelligenceEngine = "local" | "openai" | "openrouter";

export type IntelligentClassification = ClassifiedResource & {
  engine: IntelligenceEngine;
  suggestedTopics: NewTopicSuggestion[];
  suggestedSaveIntent?: SaveIntent;
  suggestedWhySaved?: string;
};

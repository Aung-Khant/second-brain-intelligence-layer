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


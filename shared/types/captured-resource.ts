// The MVP vertical slice's own shapes, deliberately separate from the legacy
// TrustedResourceInput/ClassifiedResource pipeline in types/resource.ts.
//
// The flow is: CapturedResource (deterministic facts extracted from the page)
// -> ResourceUnderstanding ("what is this?", AI pass 1) -> ClassificationResult
// ("where does it belong?", AI pass 2) -> CorrectionRecord[] (what the user
// actually did with the suggestions).
//
// Confidence here is 0-1, unlike the legacy pipeline's 0-100. See
// selectionStateFor for the thresholds that turn a confidence into UI state.

export type CapturedResource = {
  url: string;
  canonicalUrl: string | null;
  sourceType: "youtube_video";
  sourceId: string;
  title: string | null;
  creator: string | null;
  creatorId: string | null;
  description: string | null;
  pageText: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
};

export type ResourceUnderstanding = {
  summary: string;
  coreIdeas: string[];
  likelyUseCases: string[];
  contentCategory: string;
};

export type ClassificationCandidate = {
  id: string;
  name: string;
  confidence: number;
  reason: string;
};

export type ClassificationResult = {
  areas: ClassificationCandidate[];
  projects: ClassificationCandidate[];
  topics: ClassificationCandidate[];
};

export type EntityType = "area" | "project" | "topic";

export type SelectionState = "auto_selected" | "suggested" | "unselected";

export type CorrectionAction = "accepted" | "rejected" | "manually_added";

export type CorrectionRecord = {
  resourceId: string;
  resourceUrl: string;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  aiConfidence: number | null;
  aiSuggested: boolean;
  userAccepted: boolean;
  action: CorrectionAction;
  timestamp: string;
};

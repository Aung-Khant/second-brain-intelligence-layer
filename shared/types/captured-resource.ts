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

// The full set the pipeline is being built toward. A type listed here is only
// actually capturable once it has an adapter in shared/capture/source.ts -
// the registry, not this union, decides what the extension accepts.
export type SourceType =
  | "youtube_video"
  | "youtube_channel"
  | "github_repo"
  | "article"
  | "website"
  | "research_paper";

export type CapturedResource = {
  url: string;
  canonicalUrl: string | null;
  sourceType: SourceType;
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

// A category the AI thinks is missing from the taxonomy. It carries a name
// rather than an id because it does not exist yet, and it is never selected -
// only a person can turn one of these into a real Notion page.
export type EntityProposal = {
  name: string;
  reason: string;
};

export type TaxonomyProposals = {
  areas: EntityProposal[];
  topics: EntityProposal[];
};

export type ClassificationResult = {
  areas: ClassificationCandidate[];
  projects: ClassificationCandidate[];
  topics: ClassificationCandidate[];
  proposals?: TaxonomyProposals;
};

export type EntityType = "area" | "project" | "topic";

export type SelectionState = "auto_selected" | "suggested" | "unselected";

export type CorrectionAction = "accepted" | "rejected" | "manually_added";

export type CorrectionRecord = {
  // Which Notion connection produced this. Corrections are personal
  // judgements about one workspace's taxonomy, so they are never read across
  // connections.
  connectionId: string;
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

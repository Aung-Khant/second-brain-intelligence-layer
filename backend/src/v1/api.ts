// The two MVP endpoints. dev-server.ts does HTTP; this file is the flow.
//
// analyze: validate -> read Notion taxonomy -> understand -> classify -> score.
// save:    write Notion page -> record per-candidate corrections.
//
// Selection state is computed here rather than in the extension so there is a
// single source of truth for the thresholds. The popup renders what it is told.
import type {
  CapturedResource,
  ClassificationCandidate,
  ClassificationResult,
  ResourceUnderstanding,
  SelectionState
} from "../../../shared/types/captured-resource.js";
import type { Taxonomy } from "../../../shared/types/taxonomy.js";
import {
  assertCapturedResource,
  normalizeCapturedResource
} from "../../../shared/schemas/captured-resource.js";
import { AppError } from "../../../shared/types/errors.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";
import { classifyAgainstTaxonomy } from "./classify.js";
import {
  appendCorrectionRecords,
  buildCorrectionRecords,
  retrieveRelevantCorrections,
  type FinalSelection
} from "./corrections.js";
import { saveVideoResource, type SavedResource } from "./save.js";
import { understandResource } from "./understand.js";

export const confidenceThresholds = {
  autoSelect: 0.9,
  suggest: 0.7
} as const;

export type ScoredCandidate = ClassificationCandidate & {
  state: SelectionState;
};

export type ScoredClassification = {
  areas: ScoredCandidate[];
  projects: ScoredCandidate[];
  topics: ScoredCandidate[];
};

export type AnalyzeRequest = {
  resource: CapturedResource;
};

export type AnalyzeResponse = {
  resource: CapturedResource;
  understanding: ResourceUnderstanding;
  classification: ScoredClassification;
  taxonomy: Taxonomy;
};

export type SaveRequest = {
  resource: CapturedResource;
  classification: ClassificationResult;
  selection: FinalSelection;
  whySaved?: string;
};

export type SaveResponse = SavedResource;

export function selectionStateFor(confidence: number): SelectionState {
  if (confidence >= confidenceThresholds.autoSelect) return "auto_selected";
  if (confidence >= confidenceThresholds.suggest) return "suggested";
  return "unselected";
}

export async function analyzeResource(input: AnalyzeRequest): Promise<AnalyzeResponse> {
  assertCapturedResource(input?.resource);
  const resource = normalizeCapturedResource(input.resource);

  const taxonomy = await fetchNotionTaxonomy();
  const understanding = await understandResource(resource);
  const hints = await retrieveRelevantCorrections(understanding);
  const classification = await classifyAgainstTaxonomy(understanding, taxonomy, hints);

  return {
    resource,
    understanding,
    classification: scoreClassification(classification),
    taxonomy
  };
}

export async function saveAnalyzedResource(input: SaveRequest): Promise<SaveResponse> {
  assertCapturedResource(input?.resource);
  const resource = normalizeCapturedResource(input.resource);

  const name = resource.title;
  if (!name) {
    throw new AppError("PAGE_EXTRACTION_FAILED", "The video title is missing.");
  }

  const selection = normalizeSelection(input.selection);
  const classification = normalizeClassification(input.classification);

  const result = await saveVideoResource({
    name,
    url: resource.canonicalUrl ?? resource.url,
    whySaved: input.whySaved,
    areaIds: selection.areaIds,
    projectIds: selection.projectIds,
    topicIds: selection.topicIds
  });

  if (result.status === "saved") {
    await appendCorrectionRecords(
      buildCorrectionRecords({
        resourceId: result.resourceId,
        resourceUrl: resource.canonicalUrl ?? resource.url,
        classification,
        selection,
        entityNamesById: await taxonomyNamesById()
      })
    );
  }

  return result;
}

function scoreClassification(classification: ClassificationResult): ScoredClassification {
  return {
    areas: classification.areas.map(withState),
    projects: classification.projects.map(withState),
    topics: classification.topics.map(withState)
  };
}

function withState(candidate: ClassificationCandidate): ScoredCandidate {
  return { ...candidate, state: selectionStateFor(candidate.confidence) };
}

// Manually added entities arrive as bare IDs, so their names come from the
// cached taxonomy rather than the request - the correction log should record
// what the entity actually is, not what the client claimed.
async function taxonomyNamesById(): Promise<Map<string, string>> {
  const taxonomy = await fetchNotionTaxonomy();
  return new Map(
    [...taxonomy.areas, ...taxonomy.projects, ...taxonomy.topics].map((entity) => [
      entity.id,
      entity.name
    ])
  );
}

function normalizeSelection(selection: Partial<FinalSelection> | undefined): FinalSelection {
  return {
    areaIds: uniqueIds(selection?.areaIds),
    projectIds: uniqueIds(selection?.projectIds),
    topicIds: uniqueIds(selection?.topicIds)
  };
}

function normalizeClassification(
  classification: Partial<ClassificationResult> | undefined
): ClassificationResult {
  return {
    areas: candidateArray(classification?.areas),
    projects: candidateArray(classification?.projects),
    topics: candidateArray(classification?.topics)
  };
}

function candidateArray(value: unknown): ClassificationCandidate[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is ClassificationCandidate =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as ClassificationCandidate).id === "string" &&
      typeof (item as ClassificationCandidate).name === "string"
  );
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0))
  );
}

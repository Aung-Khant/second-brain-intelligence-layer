import { classifyResource } from "../ai/classify-resource.js";
import { classifyResourceWithOpenAi } from "../ai/openai-classify-resource.js";
import { shouldUseAi } from "../config/ai.js";
import { appendClassificationLog } from "../evaluation/classification-log.js";
import { checkDuplicateResourceInNotion, saveResourceToNotion } from "../notion/save-resource.js";
import { createAreaInNotion } from "../notion/save-area.js";
import { createTopicInNotion } from "../notion/save-topic.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";
import { assertConfirmedResource } from "../../../shared/schemas/save-validation.js";
import { assertTrustedResourceInput } from "../../../shared/schemas/validation.js";
import type {
  ClassifiedResource,
  IntelligentClassification,
  RelationSuggestion,
  CreatedArea,
  CreatedTopic,
  TrustedResourceInput
} from "../../../shared/types/resource.js";
import type { ConfirmedResource, SaveResourceResult } from "../../../shared/types/save.js";
import type { Taxonomy } from "../../../shared/types/taxonomy.js";

export type ClassifyApiRequest = {
  resource: TrustedResourceInput;
};

export type ClassifyApiResponse = {
  resource: TrustedResourceInput;
  classification: IntelligentClassification;
  fallback?: {
    engine: "local";
    reason: string;
  };
};

export type EnhanceApiResponse = ClassifyApiResponse;

export type TaxonomyApiResponse = {
  taxonomy: Taxonomy;
};

export type SaveApiRequest = {
  resource: ConfirmedResource;
  aiSuggestion?: {
    areas: string[];
    topics: string[];
    projects: string[];
    model?: string;
  };
  confirmWrite?: boolean;
};

export type SaveApiResponse =
  | SaveResourceResult
  | {
      status: "dry_run";
      message: string;
      resource: ConfirmedResource;
    };

export type CreateTopicApiRequest = {
  name: string;
  areaId?: string;
  areaName?: string;
  reason?: string;
};

export type CreateTopicApiResponse = {
  topic: CreatedTopic;
};

export type CreateAreaApiRequest = {
  name: string;
};

export type CreateAreaApiResponse = {
  area: CreatedArea;
};

export async function classifyWithNotionTaxonomy(
  input: ClassifyApiRequest
): Promise<ClassifyApiResponse> {
  assertTrustedResourceInput(input.resource);

  const taxonomy = await fetchNotionTaxonomy();
  return {
    resource: input.resource,
    classification: classifyLocal(input.resource, taxonomy)
  };
}

export async function enhanceClassificationWithAi(
  input: ClassifyApiRequest
): Promise<EnhanceApiResponse> {
  assertTrustedResourceInput(input.resource);

  const taxonomy = await fetchNotionTaxonomy();
  if (shouldUseAi()) {
    try {
      const localClassification = classifyLocal(input.resource, taxonomy);
      return {
        resource: input.resource,
        classification: mergeAiWithLocalRelations(
          await classifyResourceWithOpenAi(input.resource, taxonomy),
          localClassification
        )
      };
    } catch (error) {
      const localClassification = classifyLocal(input.resource, taxonomy);
      return {
        resource: input.resource,
        classification: localClassification,
        fallback: {
          engine: "local",
          reason: error instanceof Error ? error.message : "OpenAI classification failed."
        }
      };
    }
  }

  return {
    resource: input.resource,
    classification: classifyLocal(input.resource, taxonomy)
  };
}

export async function readTaxonomyForPicker(): Promise<TaxonomyApiResponse> {
  return {
    taxonomy: await fetchNotionTaxonomy()
  };
}

function mergeAiWithLocalRelations(
  aiClassification: IntelligentClassification,
  localClassification: IntelligentClassification
): IntelligentClassification {
  return {
    ...aiClassification,
    areas: mergeRelations(aiClassification.areas, localClassification.areas),
    topics: mergeRelations(aiClassification.topics, localClassification.topics),
    projects: mergeRelations(aiClassification.projects, localClassification.projects),
    suggestedAreas:
      aiClassification.areas.length > 0 || localClassification.areas.length > 0
        ? []
        : aiClassification.suggestedAreas
  };
}

function mergeRelations(
  aiRelations: RelationSuggestion[],
  localRelations: RelationSuggestion[]
): RelationSuggestion[] {
  const byId = new Map<string, RelationSuggestion>();

  for (const relation of aiRelations) {
    byId.set(relation.entityId, relation);
  }

  for (const relation of localRelations) {
    if (!byId.has(relation.entityId)) {
      byId.set(relation.entityId, relation);
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => b.confidence - a.confidence || a.entityName.localeCompare(b.entityName)
  );
}

export async function saveConfirmedResource(input: SaveApiRequest): Promise<SaveApiResponse> {
  assertConfirmedResource(input.resource);

  const duplicate = await checkDuplicateResourceInNotion(input.resource.url);
  if (duplicate) {
    return {
      status: "duplicate",
      resourceId: duplicate.id,
      resourceUrl: duplicate.url
    };
  }

  if (!input.confirmWrite) {
    return {
      status: "dry_run",
      message: "No Resource was created. Send confirmWrite: true to save into Notion.",
      resource: input.resource
    };
  }

  const result = await saveResourceToNotion(input.resource);

  if (result.status === "saved") {
    await appendClassificationLog({
      resourceUrl: input.resource.url,
      model: input.aiSuggestion?.model ?? "extension-classifier",
      aiSuggestion: input.aiSuggestion ?? {
        areas: input.resource.areaIds,
        topics: input.resource.topicIds,
        projects: input.resource.projectIds
      },
      finalSelection: {
        areas: input.resource.areaIds,
        topics: input.resource.topicIds,
        projects: input.resource.projectIds
      }
    });
  }

  return result;
}

export async function createApprovedTopic(
  input: CreateTopicApiRequest
): Promise<CreateTopicApiResponse> {
  return {
    topic: await createTopicInNotion({
      name: input.name,
      areaId: input.areaId,
      areaName: input.areaName
    })
  };
}

export async function createApprovedArea(
  input: CreateAreaApiRequest
): Promise<CreateAreaApiResponse> {
  return {
    area: await createAreaInNotion({
      name: input.name
    })
  };
}

function classifyLocal(
  resource: TrustedResourceInput,
  taxonomy: Taxonomy
): IntelligentClassification {
  const classification: ClassifiedResource = classifyResource({
    resource,
    taxonomy
  });

  return {
    ...classification,
    engine: "local",
    suggestedAreas: [],
    suggestedTopics: []
  };
}

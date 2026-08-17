import { classifyResource } from "../ai/classify-resource.js";
import { appendClassificationLog } from "../evaluation/classification-log.js";
import { checkDuplicateResourceInNotion, saveResourceToNotion } from "../notion/save-resource.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";
import { assertConfirmedResource } from "../../../shared/schemas/save-validation.js";
import { assertTrustedResourceInput } from "../../../shared/schemas/validation.js";
import type { ClassifiedResource, TrustedResourceInput } from "../../../shared/types/resource.js";
import type { ConfirmedResource, SaveResourceResult } from "../../../shared/types/save.js";

export type ClassifyApiRequest = {
  resource: TrustedResourceInput;
};

export type ClassifyApiResponse = {
  resource: TrustedResourceInput;
  classification: ClassifiedResource;
};

export type SaveApiRequest = {
  resource: ConfirmedResource;
  aiSuggestion?: {
    areas: string[];
    topics: string[];
    projects: string[];
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

export async function classifyWithNotionTaxonomy(
  input: ClassifyApiRequest
): Promise<ClassifyApiResponse> {
  assertTrustedResourceInput(input.resource);

  const taxonomy = await fetchNotionTaxonomy();
  return {
    resource: input.resource,
    classification: classifyResource({
      resource: input.resource,
      taxonomy
    })
  };
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
      model: "local-classifier",
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

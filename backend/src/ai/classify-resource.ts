// Entry point for the local (non-AI) classification path: validates the
// input, derives a ResourceUnderstanding (summary/concepts/keywords), scores
// it against the taxonomy, and validates the output shape before returning.
// Used directly by the CLI and by the server's fast "Suggest" endpoint.
import { classifyRelations } from "./classify-relations.js";
import { understandResource } from "./understand-resource.js";
import {
  assertClassifiedResource,
  assertTaxonomy,
  assertTrustedResourceInput
} from "../../../shared/schemas/validation.js";
import type {
  ClassifiedResource,
  TrustedResourceInput
} from "../../../shared/types/resource.js";
import type { Taxonomy } from "../../../shared/types/taxonomy.js";

export type ClassifyResourceRequest = {
  resource: TrustedResourceInput;
  taxonomy: Taxonomy;
};

export function classifyResource(request: ClassifyResourceRequest): ClassifiedResource {
  assertTrustedResourceInput(request.resource);
  assertTaxonomy(request.taxonomy);

  const understanding = understandResource(request.resource);
  const classified = classifyRelations(request.resource, understanding, request.taxonomy);

  assertClassifiedResource(classified);
  return classified;
}


import type {
  ClassifiedResource,
  RelationSuggestion,
  ResourceType,
  TrustedResourceInput
} from "../types/resource.js";
import type { Taxonomy } from "../types/taxonomy.js";
import { AppError } from "../types/errors.js";

const resourceTypes = new Set<ResourceType>([
  "webpage",
  "article",
  "youtube_video",
  "youtube_channel"
]);

export function assertTrustedResourceInput(
  value: unknown
): asserts value is TrustedResourceInput {
  if (!isRecord(value)) {
    throw new AppError("AI_INVALID_OUTPUT", "Resource input must be an object.");
  }

  if (!resourceTypes.has(value.type as ResourceType)) {
    throw new AppError("UNSUPPORTED_RESOURCE", "Unsupported resource type.");
  }

  if (!isNonEmptyString(value.title)) {
    throw new AppError("PAGE_EXTRACTION_FAILED", "Resource title is required.");
  }

  assertOptionalString(value.url, "url");
  assertOptionalString(value.creator, "creator");
  assertOptionalString(value.description, "description");
  assertOptionalString(value.visibleText, "visibleText");
}

export function assertTaxonomy(value: unknown): asserts value is Taxonomy {
  if (!isRecord(value)) {
    throw new AppError("AI_INVALID_OUTPUT", "Taxonomy must be an object.");
  }

  assertArray(value.areas, "areas");
  assertArray(value.topics, "topics");
  assertArray(value.projects, "projects");

  for (const area of value.areas) {
    assertEntity(area, "area");
  }

  for (const topic of value.topics) {
    assertEntity(topic, "topic");
    if (isRecord(topic) && topic.areas !== undefined) {
      assertStringArray(topic.areas, "topic.areas");
    }
  }

  for (const project of value.projects) {
    assertEntity(project, "project");
    if (!isRecord(project)) continue;
    assertOptionalString(project.goal, "project.goal");
    assertOptionalString(project.problem, "project.problem");
    assertOptionalString(project.audience, "project.audience");
    if (project.areas !== undefined) assertStringArray(project.areas, "project.areas");
    if (project.topics !== undefined) assertStringArray(project.topics, "project.topics");
    if (
      project.status !== undefined &&
      project.status !== "active" &&
      project.status !== "completed" &&
      project.status !== "archived"
    ) {
      throw new AppError("AI_INVALID_OUTPUT", "Invalid project status.");
    }
  }
}

export function assertClassifiedResource(
  value: unknown
): asserts value is ClassifiedResource {
  if (!isRecord(value)) {
    throw new AppError("AI_INVALID_OUTPUT", "Classifier output must be an object.");
  }

  if (!isNonEmptyString(value.summary)) {
    throw new AppError("AI_INVALID_OUTPUT", "Classifier summary is required.");
  }

  assertStringArray(value.concepts, "concepts");
  assertStringArray(value.keywords, "keywords");
  assertStringArray(value.subjectMatter, "subjectMatter");
  assertRelationArray(value.areas, "areas");
  assertRelationArray(value.topics, "topics");
  assertRelationArray(value.projects, "projects");
}

function assertRelationArray(value: unknown, field: string): asserts value is RelationSuggestion[] {
  assertArray(value, field);
  for (const relation of value) {
    if (!isRecord(relation)) {
      throw new AppError("AI_INVALID_OUTPUT", `${field} entries must be objects.`);
    }
    if (!isNonEmptyString(relation.entityId)) {
      throw new AppError("AI_INVALID_OUTPUT", `${field}.entityId is required.`);
    }
    if (!isNonEmptyString(relation.entityName)) {
      throw new AppError("AI_INVALID_OUTPUT", `${field}.entityName is required.`);
    }
    if (
      typeof relation.confidence !== "number" ||
      relation.confidence < 0 ||
      relation.confidence > 100
    ) {
      throw new AppError("AI_INVALID_OUTPUT", `${field}.confidence must be 0-100.`);
    }
    if (!isNonEmptyString(relation.reason)) {
      throw new AppError("AI_INVALID_OUTPUT", `${field}.reason is required.`);
    }
    if (
      relation.state !== "preselected" &&
      relation.state !== "suggested" &&
      relation.state !== "hidden"
    ) {
      throw new AppError("AI_INVALID_OUTPUT", `${field}.state is invalid.`);
    }
  }
}

function assertEntity(value: unknown, label: string): void {
  if (!isRecord(value)) {
    throw new AppError("AI_INVALID_OUTPUT", `${label} must be an object.`);
  }
  if (!isNonEmptyString(value.id)) {
    throw new AppError("AI_INVALID_OUTPUT", `${label}.id is required.`);
  }
  if (!isNonEmptyString(value.name)) {
    throw new AppError("AI_INVALID_OUTPUT", `${label}.name is required.`);
  }
  assertOptionalString(value.definition, `${label}.definition`);
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new AppError("AI_INVALID_OUTPUT", `${field} must be a string when present.`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  assertArray(value, field);
  for (const item of value) {
    if (typeof item !== "string") {
      throw new AppError("AI_INVALID_OUTPUT", `${field} must contain strings.`);
    }
  }
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new AppError("AI_INVALID_OUTPUT", `${field} must be an array.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}


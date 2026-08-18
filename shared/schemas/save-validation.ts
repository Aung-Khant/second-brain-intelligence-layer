// Runtime guard for the final ConfirmedResource shape a user has reviewed
// and approved for saving - the last checkpoint before Notion writes happen
// (see notion/save-resource.ts). Requires a Save Intent and a supported
// resource type; everything else (Areas/Topics/Projects, Why Saved) is
// optional since the user is allowed to save with nothing selected.
import type { ConfirmedResource } from "../types/save.js";
import type { ResourceType, SaveIntent } from "../types/resource.js";
import { AppError } from "../types/errors.js";

const resourceTypes = new Set<ResourceType>([
  "webpage",
  "article",
  "youtube_video",
  "youtube_channel"
]);

const saveIntents = new Set<SaveIntent>([
  "learn",
  "use_for_project",
  "research",
  "reference",
  "content_inspiration",
  "explore_later",
  "other"
]);

export function assertConfirmedResource(value: unknown): asserts value is ConfirmedResource {
  if (!isRecord(value)) {
    throw new AppError("AI_INVALID_OUTPUT", "Confirmed resource must be an object.");
  }

  if (!isNonEmptyString(value.name)) {
    throw new AppError("AI_INVALID_OUTPUT", "Confirmed resource name is required.");
  }

  if (!isNonEmptyString(value.url)) {
    throw new AppError("AI_INVALID_OUTPUT", "Confirmed resource URL is required.");
  }

  if (!resourceTypes.has(value.resourceType as ResourceType)) {
    throw new AppError("UNSUPPORTED_RESOURCE", "Unsupported confirmed resource type.");
  }

  if (!saveIntents.has(value.saveIntent as SaveIntent)) {
    throw new AppError("AI_INVALID_OUTPUT", "Save Intent is required.");
  }

  assertStringArray(value.areaIds, "areaIds");
  assertStringArray(value.topicIds, "topicIds");
  assertStringArray(value.projectIds, "projectIds");
  assertOptionalString(value.description, "description");
  assertOptionalString(value.summary, "summary");
  assertOptionalString(value.whySaved, "whySaved");
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new AppError("AI_INVALID_OUTPUT", `${field} must be a string when present.`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new AppError("AI_INVALID_OUTPUT", `${field} must be an array.`);
  }

  for (const item of value) {
    if (typeof item !== "string") {
      throw new AppError("AI_INVALID_OUTPUT", `${field} must contain strings.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}


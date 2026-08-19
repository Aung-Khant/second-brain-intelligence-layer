// AI pass 1: "What is this resource actually about?"
//
// This pass is deliberately blind to the user's taxonomy. If the model can see
// the Areas and Topics while summarizing, it writes a summary that leans toward
// whatever it expects to match, and pass 2 then "confirms" a conclusion that
// pass 1 already smuggled in. Keeping them separate means the classifier scores
// against a description of the video, not a description of the answer.
import type {
  CapturedResource,
  ResourceUnderstanding
} from "../../../shared/types/captured-resource.js";
import { requestJson, toCleanString, toStringArray } from "./ai-client.js";

const maxDescriptionCharacters = 4000;

const understandingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description:
        "Two or three sentences, roughly 40 to 60 words. Enough to reconstruct what this covers months later without reopening it."
    },
    coreIdeas: {
      type: "array",
      items: { type: "string" },
      description: "The main concepts the video actually teaches or argues."
    },
    likelyUseCases: {
      type: "array",
      items: { type: "string" },
      description: "What someone could realistically do with this knowledge."
    },
    contentCategory: {
      type: "string",
      description: "One short label, e.g. tutorial, conference talk, interview, explainer."
    }
  },
  required: ["summary", "coreIdeas", "likelyUseCases", "contentCategory"]
} as const;

export async function understandResource(
  resource: CapturedResource
): Promise<ResourceUnderstanding> {
  const output = await requestJson<Partial<ResourceUnderstanding>>({
    schemaName: "resource_understanding",
    schema: understandingSchema,
    prompt: buildPrompt(resource),
    maxOutputTokens: 1200
  });

  return {
    summary: toCleanString(output.summary, resource.title ?? ""),
    coreIdeas: toStringArray(output.coreIdeas, 8),
    likelyUseCases: toStringArray(output.likelyUseCases, 5),
    contentCategory: toCleanString(output.contentCategory, "video")
  };
}

function buildPrompt(resource: CapturedResource): string {
  const isChannel = resource.sourceType === "youtube_channel";
  const noun = isChannel ? "YouTube channel" : "YouTube video";

  return [
    `You are describing a ${noun} so it can be filed into a personal knowledge base.`,
    `Describe only what the ${isChannel ? "channel publishes" : "video is about"}. Do not suggest where it should be filed.`,
    "Base your answer on the title, name, and description below.",
    "If the description is thin, infer conservatively from the title and name, and keep the summary short rather than inventing specifics.",
    "Never invent facts, statistics, or claims that are not supported by the text provided.",
    "",
    "The summary is two or three sentences, roughly 40 to 60 words. It should let",
    "someone skim it months from now and know what this covers and whether to reopen it.",
    "Name the specific subjects covered rather than describing them in the abstract.",
    `Skip filler like "this ${isChannel ? "channel" : "video"} is about" - start with the substance.`,
    isChannel
      ? "coreIdeas should be the recurring subjects the channel covers, not one video's topics."
      : "coreIdeas should be the concepts the video actually teaches or argues.",
    "",
    isChannel ? "CHANNEL" : "VIDEO",
    `${isChannel ? "Name" : "Title"}: ${resource.title ?? "(unknown)"}`,
    isChannel ? "" : `Channel: ${resource.creator ?? "(unknown)"}`,
    resource.publishedAt ? `Published: ${resource.publishedAt}` : "",
    "",
    "Description:",
    resource.description?.slice(0, maxDescriptionCharacters) || "(no description available)",
    "",
    "Return JSON matching the required schema."
  ]
    .filter(Boolean)
    .join("\n");
}

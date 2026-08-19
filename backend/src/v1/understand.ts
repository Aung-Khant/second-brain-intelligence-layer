// AI pass 1: "What is this resource actually about?"
//
// This pass is deliberately blind to the user's taxonomy. If the model can see
// the Areas and Topics while summarizing, it writes a summary that leans toward
// whatever it expects to match, and pass 2 then "confirms" a conclusion that
// pass 1 already smuggled in. Keeping them separate means the classifier scores
// against a description of the video, not a description of the answer.
import type {
  CapturedResource,
  ResourceUnderstanding,
  SourceType
} from "../../../shared/types/captured-resource.js";
import { requestJson, toCleanString, toStringArray } from "./ai-client.js";

const maxDescriptionCharacters = 4000;
// Body text is capped harder than a description: it is noisier per character,
// and a long article should not crowd out the title and description that
// matter more.
const maxPageTextCharacters = 6000;

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

// How each source type should be talked about. Kept as data rather than
// branching so a new source type adds a row here instead of another
// conditional threaded through the prompt.
type SourceVoice = {
  noun: string;
  heading: string;
  titleLabel: string;
  // What the model should describe, and what belongs in coreIdeas.
  describe: string;
  coreIdeas: string;
  // Label for the creator line, or null when the source has no meaningful
  // author distinct from the title.
  creatorLabel: string | null;
};

const voices: Record<SourceType, SourceVoice> = {
  youtube_video: {
    noun: "YouTube video",
    heading: "VIDEO",
    titleLabel: "Title",
    describe: "what the video is about",
    coreIdeas: "the concepts the video actually teaches or argues",
    creatorLabel: "Channel"
  },
  youtube_channel: {
    noun: "YouTube channel",
    heading: "CHANNEL",
    titleLabel: "Name",
    describe: "what the channel publishes",
    coreIdeas: "the recurring subjects the channel covers, not one video's topics",
    creatorLabel: null
  },
  github_repo: {
    noun: "GitHub repository",
    heading: "REPOSITORY",
    titleLabel: "Repository",
    describe: "what the project does and what it is for",
    coreIdeas: "the problems the project solves and the techniques it uses",
    creatorLabel: "Owner"
  },
  article: {
    noun: "article",
    heading: "ARTICLE",
    titleLabel: "Title",
    describe: "what the article argues or explains",
    coreIdeas: "the claims the article makes and the evidence it rests on",
    creatorLabel: "Author"
  },
  website: {
    noun: "web page",
    heading: "PAGE",
    titleLabel: "Title",
    describe: "what this page offers or documents",
    coreIdeas: "what the page is useful for",
    creatorLabel: "Site"
  },
  research_paper: {
    noun: "research paper",
    heading: "PAPER",
    titleLabel: "Title",
    describe: "what the paper investigates and what it found",
    coreIdeas: "the contribution, the method, and the findings",
    creatorLabel: "Authors"
  }
};

function buildPrompt(resource: CapturedResource): string {
  const voice = voices[resource.sourceType];

  return [
    `You are describing a ${voice.noun} so it can be filed into a personal knowledge base.`,
    `Describe only ${voice.describe}. Do not suggest where it should be filed.`,
    "Base your answer on the title, name, and description below.",
    "If the description is thin, infer conservatively from the title and name, and keep the summary short rather than inventing specifics.",
    "Never invent facts, statistics, or claims that are not supported by the text provided.",
    "",
    "The summary is two or three sentences, roughly 40 to 60 words. It should let",
    "someone skim it months from now and know what this covers and whether to reopen it.",
    "Name the specific subjects covered rather than describing them in the abstract.",
    `Skip filler like "this ${voice.noun} is about" - start with the substance.`,
    `coreIdeas should be ${voice.coreIdeas}.`,
    "",
    voice.heading,
    `${voice.titleLabel}: ${resource.title ?? "(unknown)"}`,
    voice.creatorLabel ? `${voice.creatorLabel}: ${resource.creator ?? "(unknown)"}` : "",
    resource.publishedAt ? `Published: ${resource.publishedAt}` : "",
    "",
    "Description:",
    resource.description?.slice(0, maxDescriptionCharacters) || "(no description available)",
    // pageText is null for every source that has a real description of its
    // own. It carries the body for sources where the description is a stub -
    // which is most of the web.
    ...(resource.pageText
      ? ["", "Page text:", resource.pageText.slice(0, maxPageTextCharacters)]
      : []),
    "",
    "Return JSON matching the required schema."
  ]
    .filter(Boolean)
    .join("\n");
}

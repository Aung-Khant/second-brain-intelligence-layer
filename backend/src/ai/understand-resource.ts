// Turns a raw TrustedResourceInput into a ResourceUnderstanding (summary,
// concepts, keywords, subjectMatter) using plain text heuristics - no AI
// call. Deliberately excludes a YouTube page's visibleText (nav, comments,
// recommended videos - not the video itself) and strips YouTube's generic
// platform boilerplate description, using only title/creator/description for
// video and channel pages. Every other local matcher in this codebase should
// follow the same YouTube exclusion rule (see classify-relations.ts and
// area-suggestion-fallback.ts).
import { classifierConfig } from "../config/classification.js";
import type {
  ResourceUnderstanding,
  TrustedResourceInput
} from "../../../shared/types/resource.js";

const stopWords = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "but",
  "can",
  "for",
  "from",
  "how",
  "into",
  "its",
  "the",
  "this",
  "that",
  "their",
  "then",
  "they",
  "through",
  "use",
  "using",
  "with",
  "you",
  "your"
]);

const conceptPhrases = [
  "linear algebra",
  "machine learning",
  "computer vision",
  "mathematical visualization",
  "visual explanation",
  "visual explanations",
  "eigenvector",
  "eigenvectors",
  "matrix",
  "matrices",
  "manim",
  "memory",
  "spaced repetition",
  "attention",
  "learning",
  "pronunciation",
  "startup",
  "business",
  "strategy",
  "product"
];

export function understandResource(resource: TrustedResourceInput): ResourceUnderstanding {
  const text = resourceText(resource);
  const normalized = normalizeText(text);
  const concepts = extractConcepts(normalized);
  const keywords = extractKeywords(normalized);
  const subjectMatter = Array.from(new Set([...concepts, ...keywords.slice(0, 8)]));

  return {
    summary: summarize(resource),
    concepts,
    keywords,
    subjectMatter
  };
}

function summarize(resource: TrustedResourceInput): string {
  const creator = resource.creator ? ` by ${resource.creator}` : "";
  const title = cleanTitle(resource.title, resource.type);
  const description = stripGenericDescription(resource.description, resource.type);
  if (description) {
    return `${title}${creator}: ${description}`;
  }

  if (resource.type === "youtube_video") {
    return `YouTube video: ${title}${creator}.`;
  }

  if (resource.type === "youtube_channel") {
    return `YouTube channel: ${title}${creator}.`;
  }

  return `${title}${creator}`;
}

function resourceText(resource: TrustedResourceInput): string {
  const shouldUseVisibleText =
    resource.type !== "youtube_video" && resource.type !== "youtube_channel";

  return [
    cleanTitle(resource.title, resource.type),
    resource.creator,
    stripGenericDescription(resource.description, resource.type),
    shouldUseVisibleText
      ? resource.visibleText?.slice(0, classifierConfig.maxVisibleTextCharacters)
      : undefined
  ]
    .filter(Boolean)
    .join(" ");
}

function cleanTitle(title: string, type: TrustedResourceInput["type"]): string {
  if (type !== "youtube_video" && type !== "youtube_channel") return title.trim();

  return title
    .trim()
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s+-\s+YouTube$/i, "")
    .trim();
}

function stripGenericDescription(
  value: string | undefined,
  type: TrustedResourceInput["type"]
): string | undefined {
  if (!value) return undefined;

  const description = value.trim();
  if (type !== "youtube_video" && type !== "youtube_channel") return description;

  const genericYoutubeDescription =
    "Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.";

  return description === genericYoutubeDescription ? undefined : description;
}

function extractConcepts(normalized: string): string[] {
  const found = new Set<string>();
  for (const phrase of conceptPhrases) {
    if (normalized.includes(phrase)) {
      found.add(toTitlePhrase(phrase));
    }
  }
  return Array.from(found);
}

function extractKeywords(normalized: string): string[] {
  const counts = new Map<string, number>();
  for (const rawToken of normalized.split(/\s+/)) {
    const token = rawToken.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (token.length < 3 || stopWords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([keyword]) => keyword);
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@#+.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitlePhrase(phrase: string): string {
  return phrase
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

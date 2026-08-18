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
  const description = resource.description?.trim();
  if (description) {
    return `${resource.title}${creator}: ${description}`;
  }
  return `${resource.title}${creator}`;
}

function resourceText(resource: TrustedResourceInput): string {
  const shouldUseVisibleText =
    resource.type !== "youtube_video" && resource.type !== "youtube_channel";

  return [
    resource.title,
    resource.creator,
    resource.description,
    shouldUseVisibleText
      ? resource.visibleText?.slice(0, classifierConfig.maxVisibleTextCharacters)
      : undefined
  ]
    .filter(Boolean)
    .join(" ");
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

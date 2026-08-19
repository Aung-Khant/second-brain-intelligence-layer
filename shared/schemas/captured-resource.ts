// The validation gate. Everything here is a fact check, not a judgement: bad
// metadata fails loudly at the door rather than reaching the AI, where a wrong
// title would quietly produce a confident, wrong classification.
//
// The checks that apply to every source live here. The check that proves the
// captured data really describes the page in the address bar is per-source and
// lives with its adapter in shared/capture/source.ts, because how you prove it
// depends entirely on what kind of identifier the source has - a video id can
// be compared exactly, a general web page has nothing to compare but its URL.
import { AppError } from "../types/errors.js";
import type { CapturedResource } from "../types/captured-resource.js";
import { cleanYouTubeTitle } from "../capture/youtube.js";
import {
  assertSourceIdentity,
  canonicalUrlFor,
  detectSource,
  isSupportedSourceType
} from "../capture/source.js";

export function assertCapturedResource(value: unknown): asserts value is CapturedResource {
  if (!isRecord(value)) {
    throw new AppError("PAGE_EXTRACTION_FAILED", "No page data was captured.");
  }

  if (!isSupportedSourceType(value.sourceType)) {
    throw new AppError(
      "UNSUPPORTED_RESOURCE",
      "Only YouTube videos and channels are supported right now."
    );
  }

  const url = requireString(value.url, "url");
  const detected = detectSource(url);

  if (!detected) {
    throw new AppError(
      "UNSUPPORTED_RESOURCE",
      "This page is not a YouTube video or channel URL."
    );
  }

  // The client claimed one kind of resource and the URL says another, which
  // means the capture raced a navigation.
  if (detected.sourceType !== value.sourceType) {
    throw new AppError(
      "PAGE_IDENTITY_MISMATCH",
      "The captured data does not match the page URL. Reload and try again."
    );
  }

  requireString(value.sourceId, "sourceId");

  if (!cleanTitle(value.title)) {
    throw new AppError(
      "PAGE_EXTRACTION_FAILED",
      "Could not read the title. Let the page finish loading and try again."
    );
  }

  assertSourceIdentity(value, detected);
}

// Trusts only the fields that survived validation. canonicalUrl is rebuilt
// from the verified identity so a missing or stale <link rel="canonical">
// can't put a wrong URL into Notion, and the title is stripped of tab-title
// noise like a "(87)" unread badge.
export function normalizeCapturedResource(resource: CapturedResource): CapturedResource {
  const detected = detectSource(resource.url);

  return {
    ...resource,
    canonicalUrl: (detected && canonicalUrlFor(detected)) ?? resource.canonicalUrl,
    title: cleanTitle(resource.title),
    creator: emptyToNull(resource.creator),
    creatorId: emptyToNull(resource.creatorId),
    description: emptyToNull(resource.description),
    pageText: emptyToNull(resource.pageText),
    publishedAt: emptyToNull(resource.publishedAt),
    thumbnailUrl: emptyToNull(resource.thumbnailUrl)
  };
}

// Tab-title cleanup is currently YouTube-shaped. Other sources will want their
// own site-suffix stripping, at which point this moves behind the adapter -
// but inventing that indirection before a second case exists would be guessing
// at what it needs.
function cleanTitle(value: unknown): string | null {
  return cleanYouTubeTitle(typeof value === "string" ? value : null);
}

function emptyToNull(value: string | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("PAGE_EXTRACTION_FAILED", `Missing required field: ${field}.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

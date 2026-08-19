// Step 1's validation gate. Everything here is a fact check, not a judgement:
// bad metadata fails loudly at the door rather than reaching the AI, where a
// wrong title would quietly produce a confident, wrong classification.
//
// PAGE_IDENTITY_MISMATCH is the important one - the extension reads the URL
// and the DOM at slightly different moments, and YouTube is a single-page app
// that swaps video content without a reload. Without this check, clicking the
// extension mid-navigation can classify video A's metadata under video B's URL.
import { AppError } from "../types/errors.js";
import type { CapturedResource } from "../types/captured-resource.js";
import { canonicalYouTubeUrl, parseYouTubeVideoId } from "../capture/youtube.js";

export function assertCapturedResource(value: unknown): asserts value is CapturedResource {
  if (!isRecord(value)) {
    throw new AppError("PAGE_EXTRACTION_FAILED", "No page data was captured.");
  }

  if (value.sourceType !== "youtube_video") {
    throw new AppError(
      "UNSUPPORTED_RESOURCE",
      "Only YouTube videos are supported right now."
    );
  }

  const url = requireString(value.url, "url", "PAGE_EXTRACTION_FAILED");
  const videoIdFromUrl = parseYouTubeVideoId(url);
  if (!videoIdFromUrl) {
    throw new AppError(
      "UNSUPPORTED_RESOURCE",
      "This page is not a YouTube video URL. Open a video and try again."
    );
  }

  const sourceId = requireString(value.sourceId, "sourceId", "PAGE_EXTRACTION_FAILED");
  if (sourceId !== videoIdFromUrl) {
    throw new AppError(
      "PAGE_IDENTITY_MISMATCH",
      "The captured video does not match the page URL. Reload the page and try again."
    );
  }

  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) {
    throw new AppError(
      "PAGE_EXTRACTION_FAILED",
      "Could not read the video title. Let the page finish loading and try again."
    );
  }

  if (value.canonicalUrl !== null && typeof value.canonicalUrl === "string") {
    const videoIdFromCanonical = parseYouTubeVideoId(value.canonicalUrl);
    if (videoIdFromCanonical && videoIdFromCanonical !== sourceId) {
      throw new AppError(
        "PAGE_IDENTITY_MISMATCH",
        "The canonical link points at a different video. Reload the page and try again."
      );
    }
  }
}

// Trusts only the fields that survived validation, and rebuilds canonicalUrl
// from the verified video ID so a missing or stale <link rel="canonical">
// can't put a wrong URL into Notion.
export function normalizeCapturedResource(resource: CapturedResource): CapturedResource {
  return {
    ...resource,
    canonicalUrl: canonicalYouTubeUrl(resource.sourceId),
    title: resource.title?.trim() || null,
    creator: emptyToNull(resource.creator),
    creatorId: emptyToNull(resource.creatorId),
    description: emptyToNull(resource.description),
    pageText: emptyToNull(resource.pageText),
    publishedAt: emptyToNull(resource.publishedAt),
    thumbnailUrl: emptyToNull(resource.thumbnailUrl)
  };
}

function emptyToNull(value: string | null): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function requireString(value: unknown, field: string, code: "PAGE_EXTRACTION_FAILED"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(code, `Missing required field: ${field}.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

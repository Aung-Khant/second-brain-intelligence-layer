// The validation gate. Everything here is a fact check, not a judgement: bad
// metadata fails loudly at the door rather than reaching the AI, where a wrong
// title would quietly produce a confident, wrong classification.
//
// PAGE_IDENTITY_MISMATCH is the important one for videos - the extension reads
// the URL and the DOM at slightly different moments, and YouTube is a
// single-page app that swaps video content without a reload. Without this
// check, clicking the extension mid-navigation can classify video A's
// metadata under video B's URL.
//
// Channels are checked more loosely on purpose: a channel URL may address the
// page by handle (@name) while the page's own data reports the stable UC id.
// Those are both correct identities for the same channel and cannot be
// compared directly, so requiring equality would reject valid captures.
import { AppError } from "../types/errors.js";
import type { CapturedResource } from "../types/captured-resource.js";
import {
  canonicalYouTubeUrl,
  cleanYouTubeTitle,
  parseYouTubeTarget,
  parseYouTubeVideoId
} from "../capture/youtube.js";

export function assertCapturedResource(value: unknown): asserts value is CapturedResource {
  if (!isRecord(value)) {
    throw new AppError("PAGE_EXTRACTION_FAILED", "No page data was captured.");
  }

  const sourceType = value.sourceType;
  if (sourceType !== "youtube_video" && sourceType !== "youtube_channel") {
    throw new AppError(
      "UNSUPPORTED_RESOURCE",
      "Only YouTube videos and channels are supported right now."
    );
  }

  const url = requireString(value.url, "url");
  const target = parseYouTubeTarget(url);

  if (!target) {
    throw new AppError(
      "UNSUPPORTED_RESOURCE",
      "This page is not a YouTube video or channel URL."
    );
  }

  const expectedType = target.kind === "video" ? "youtube_video" : "youtube_channel";
  if (expectedType !== sourceType) {
    throw new AppError(
      "PAGE_IDENTITY_MISMATCH",
      `The URL is a ${target.kind}, but the captured data says otherwise. Reload and try again.`
    );
  }

  requireString(value.sourceId, "sourceId");

  if (!cleanYouTubeTitle(typeof value.title === "string" ? value.title : null)) {
    throw new AppError(
      "PAGE_EXTRACTION_FAILED",
      "Could not read the title. Let the page finish loading and try again."
    );
  }

  if (sourceType === "youtube_video") {
    assertVideoIdentity(value, target.id);
  } else {
    assertChannelIdentity(value, target.id);
  }
}

// A channel can be addressed by handle (@name) or by UC id, and those are not
// interchangeable - so this only compares like with like. When the captured
// id is the same *kind* as the URL's, they must agree: a mismatch means the
// capture raced a single-page-app navigation and describes another channel.
function assertChannelIdentity(value: Record<string, unknown>, idFromUrl: string): void {
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  const bothHandles = idFromUrl.startsWith("@") && sourceId.startsWith("@");
  const bothIds = !idFromUrl.startsWith("@") && !sourceId.startsWith("@");

  if (!bothHandles && !bothIds) return;

  if (sourceId.toLowerCase() !== idFromUrl.toLowerCase()) {
    throw new AppError(
      "PAGE_IDENTITY_MISMATCH",
      "The captured channel does not match the page URL. Reload the page and try again."
    );
  }
}

function assertVideoIdentity(value: Record<string, unknown>, videoIdFromUrl: string): void {
  if (value.sourceId !== videoIdFromUrl) {
    throw new AppError(
      "PAGE_IDENTITY_MISMATCH",
      "The captured video does not match the page URL. Reload the page and try again."
    );
  }

  if (typeof value.canonicalUrl === "string") {
    const fromCanonical = parseYouTubeVideoId(value.canonicalUrl);
    if (fromCanonical && fromCanonical !== value.sourceId) {
      throw new AppError(
        "PAGE_IDENTITY_MISMATCH",
        "The canonical link points at a different video. Reload the page and try again."
      );
    }
  }
}

// Trusts only the fields that survived validation. canonicalUrl is rebuilt
// from the verified identity so a missing or stale <link rel="canonical">
// can't put a wrong URL into Notion, and the title is stripped of tab-title
// noise like a "(87)" unread badge.
export function normalizeCapturedResource(resource: CapturedResource): CapturedResource {
  const target = parseYouTubeTarget(resource.url);

  return {
    ...resource,
    canonicalUrl: target ? canonicalYouTubeUrl(target) : resource.canonicalUrl,
    title: cleanYouTubeTitle(resource.title),
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

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("PAGE_EXTRACTION_FAILED", `Missing required field: ${field}.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

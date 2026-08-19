// The capture registry: URL in, source adapter out.
//
// Everything that is specific to *one kind of resource* lives in an adapter
// here, so the rest of the pipeline never branches on source type. Both AI
// passes, the confidence bands, taxonomy matching, the correction log, and
// duplicate detection already work on a title, a description, and some text -
// none of them know what YouTube is, and none of them should learn.
//
// An adapter answers four questions and nothing else:
//   detect        is this URL mine, and what is its stable id?
//   canonicalUrl  what is the one true URL for that id?
//   assertIdentity does the captured data really describe that id?
//   notionType    which Notion Type option does it save as?
//
// Adding a source type means adding an adapter to `adapters` below. If it
// means editing anything outside this file plus an extractor, the seam is in
// the wrong place.
import { AppError } from "../types/errors.js";
import type { SourceType } from "../types/captured-resource.js";
import {
  canonicalYouTubeUrl,
  parseYouTubeChannelId,
  parseYouTubeVideoId
} from "./youtube.js";

export type DetectedSource = {
  sourceType: SourceType;
  // The stable identifier this URL addresses - a video id, a repo full name, a
  // DOI. Null for sources that have no id of their own (a general web page is
  // identified only by its URL), which is exactly the case where identity
  // checking is weaker.
  id: string | null;
};

type SourceAdapter = {
  detect(url: URL, rawUrl: string): DetectedSource | null;
  canonicalUrl(detected: DetectedSource): string | null;
  assertIdentity(captured: Record<string, unknown>, detected: DetectedSource): void;
  notionType: string;
};

const youtubeVideo: SourceAdapter = {
  detect(_url, rawUrl) {
    const id = parseYouTubeVideoId(rawUrl);
    return id ? { sourceType: "youtube_video", id } : null;
  },

  canonicalUrl(detected) {
    return detected.id ? canonicalYouTubeUrl({ kind: "video", id: detected.id }) : null;
  },

  // The strictest check available anywhere in the system, and the reason it
  // exists: YouTube swaps video content without a reload, so the DOM can
  // describe a different video than the URL the user is looking at.
  assertIdentity(captured, detected) {
    if (captured.sourceId !== detected.id) {
      throw new AppError(
        "PAGE_IDENTITY_MISMATCH",
        "The captured video does not match the page URL. Reload the page and try again."
      );
    }

    if (typeof captured.canonicalUrl === "string") {
      const fromCanonical = parseYouTubeVideoId(captured.canonicalUrl);
      if (fromCanonical && fromCanonical !== captured.sourceId) {
        throw new AppError(
          "PAGE_IDENTITY_MISMATCH",
          "The canonical link points at a different video. Reload the page and try again."
        );
      }
    }
  },

  notionType: "Video"
};

const youtubeChannel: SourceAdapter = {
  detect(_url, rawUrl) {
    const id = parseYouTubeChannelId(rawUrl);
    return id ? { sourceType: "youtube_channel", id } : null;
  },

  canonicalUrl(detected) {
    return detected.id ? canonicalYouTubeUrl({ kind: "channel", id: detected.id }) : null;
  },

  // Looser than video on purpose. A channel is addressable by handle (@name)
  // or by UC id, and those are both correct identities for the same channel
  // and cannot be compared. So this compares like with like, and stays silent
  // when the captured id is a different kind from the URL's.
  assertIdentity(captured, detected) {
    const sourceId = typeof captured.sourceId === "string" ? captured.sourceId : "";
    const fromUrl = detected.id ?? "";
    const bothHandles = fromUrl.startsWith("@") && sourceId.startsWith("@");
    const bothIds = !fromUrl.startsWith("@") && !sourceId.startsWith("@");

    if (!bothHandles && !bothIds) return;

    if (sourceId.toLowerCase() !== fromUrl.toLowerCase()) {
      throw new AppError(
        "PAGE_IDENTITY_MISMATCH",
        "The captured channel does not match the page URL. Reload the page and try again."
      );
    }
  },

  notionType: "YouTube Channel"
};

// Order matters: the first adapter to claim a URL wins. More specific sources
// must come before more general ones.
const adapters: SourceAdapter[] = [youtubeVideo, youtubeChannel];

const adaptersByType = new Map<SourceType, SourceAdapter>([
  ["youtube_video", youtubeVideo],
  ["youtube_channel", youtubeChannel]
]);

export function detectSource(rawUrl: string): DetectedSource | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  for (const adapter of adapters) {
    const detected = adapter.detect(parsed, rawUrl);
    if (detected) return detected;
  }

  return null;
}

export function canonicalUrlFor(detected: DetectedSource): string | null {
  return adaptersByType.get(detected.sourceType)?.canonicalUrl(detected) ?? null;
}

export function assertSourceIdentity(
  captured: Record<string, unknown>,
  detected: DetectedSource
): void {
  adaptersByType.get(detected.sourceType)?.assertIdentity(captured, detected);
}

export function notionTypeFor(sourceType: SourceType): string {
  const notionType = adaptersByType.get(sourceType)?.notionType;
  if (!notionType) {
    // Reaching here means a source type exists with no adapter. Failing loudly
    // beats writing a Type value Notion doesn't have, which is a hard 400.
    throw new AppError("UNSUPPORTED_RESOURCE", `No Notion Type is mapped for ${sourceType}.`);
  }

  return notionType;
}

export function isSupportedSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && adaptersByType.has(value as SourceType);
}

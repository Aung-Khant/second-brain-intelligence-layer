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
  // Types this adapter's URLs may legitimately be captured as. Usually just
  // the one it detects, but a generic page can only be told apart from an
  // article by looking at the page itself, so the extractor is allowed to
  // refine the guess the URL made.
  accepts?: SourceType[];
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

// GitHub is the one source with a real API, so identity is exact and the data
// needs no scraping at all. Only repository URLs qualify - the reserved paths
// below are GitHub's own pages, not anybody's repo.
const reservedGitHubPaths = new Set([
  "features",
  "pricing",
  "about",
  "topics",
  "collections",
  "trending",
  "marketplace",
  "sponsors",
  "settings",
  "notifications",
  "explore",
  "orgs",
  "organizations",
  "login",
  "join",
  "search",
  "apps",
  "codespaces",
  "issues",
  "pulls",
  "new"
]);

const githubRepo: SourceAdapter = {
  detect(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "github.com") return null;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;

    const [owner, repo] = segments;
    if (reservedGitHubPaths.has(owner.toLowerCase())) return null;
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;

    // A URL deep inside a repo (/blob, /issues, /pull) still identifies the
    // repo, which is the thing worth saving.
    return { sourceType: "github_repo", id: `${owner}/${repo.replace(/\.git$/, "")}` };
  },

  canonicalUrl(detected) {
    return detected.id ? `https://github.com/${detected.id}` : null;
  },

  assertIdentity(captured, detected) {
    const sourceId = typeof captured.sourceId === "string" ? captured.sourceId : "";
    if (sourceId.toLowerCase() !== (detected.id ?? "").toLowerCase()) {
      throw new AppError(
        "PAGE_IDENTITY_MISMATCH",
        "The captured repository does not match the page URL. Reload and try again."
      );
    }
  },

  notionType: "Website"
};

// Academic publishers that reliably serve Highwire Press citation_* meta tags.
// A paper on a host not listed here still captures - it just arrives as an
// article, which is a reasonable thing for it to be.
const paperHosts = [
  "arxiv.org",
  "doi.org",
  "dx.doi.org",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "biorxiv.org",
  "medrxiv.org",
  "dl.acm.org",
  "ieeexplore.ieee.org",
  "papers.ssrn.com",
  "semanticscholar.org",
  "openreview.net",
  "sciencedirect.com",
  "nature.com",
  "jstor.org"
];

const researchPaper: SourceAdapter = {
  detect(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!paperHosts.some((paperHost) => host === paperHost || host.endsWith(`.${paperHost}`))) {
      return null;
    }

    // arXiv identifies a paper by id; everything else falls back to the URL,
    // which is still stable enough for these hosts.
    const arxiv = url.pathname.match(/\/(?:abs|pdf)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?$/);
    return {
      sourceType: "research_paper",
      id: arxiv ? `arxiv:${arxiv[1]}` : null
    };
  },

  canonicalUrl(detected) {
    // A PDF has no DOM to read, so point at the abstract page instead - it is
    // the same paper and it is actually capturable.
    return detected.id?.startsWith("arxiv:")
      ? `https://arxiv.org/abs/${detected.id.slice("arxiv:".length)}`
      : null;
  },

  assertIdentity(captured, detected) {
    if (!detected.id) return;
    const sourceId = typeof captured.sourceId === "string" ? captured.sourceId : "";
    if (sourceId && sourceId !== detected.id) {
      throw new AppError(
        "PAGE_IDENTITY_MISMATCH",
        "The captured paper does not match the page URL. Reload and try again."
      );
    }
  },

  notionType: "Article"
};

// The fallback: anything on the web no other adapter claimed. Whether it is an
// article or a plain page cannot be known from the URL, so detection guesses
// "website" and the extractor is allowed to refine it from page signals.
const webpage: SourceAdapter = {
  detect(url) {
    // Never claim a local address: the extension talks to 127.0.0.1 itself,
    // and saving your own backend is never what you meant.
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
    if (!url.hostname.includes(".")) return null;

    return { sourceType: "website", id: null };
  },

  // A general page has no identity beyond its URL, so there is nothing to
  // rebuild and nothing to check. This is the weaker guarantee the plan called
  // out - worth stating in code rather than leaving implied.
  canonicalUrl() {
    return null;
  },

  assertIdentity() {},

  notionType: "Website",
  accepts: ["website", "article"]
};

// Order matters: the first adapter to claim a URL wins, so specific sources
// come before general ones and the webpage fallback comes last.
const adapters: SourceAdapter[] = [
  youtubeVideo,
  youtubeChannel,
  githubRepo,
  researchPaper,
  webpage
];

const adaptersByType = new Map<SourceType, SourceAdapter>([
  ["youtube_video", youtubeVideo],
  ["youtube_channel", youtubeChannel],
  ["github_repo", githubRepo],
  ["research_paper", researchPaper],
  ["website", webpage],
  ["article", { ...webpage, notionType: "Article" }]
]);

export function sourceTypeIsAccepted(claimed: SourceType, detected: DetectedSource): boolean {
  const adapter = adaptersByType.get(detected.sourceType);
  const accepted = adapter?.accepts ?? [detected.sourceType];
  return accepted.includes(claimed);
}

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

import assert from "node:assert/strict";
import test from "node:test";
import { canonicalYouTubeUrl, parseYouTubeVideoId } from "../shared/capture/youtube.js";
import {
  assertCapturedResource,
  normalizeCapturedResource
} from "../shared/schemas/captured-resource.js";
import { AppError } from "../shared/types/errors.js";
import type { CapturedResource } from "../shared/types/captured-resource.js";

const videoId = "dQw4w9WgXcQ";

function validResource(overrides: Partial<CapturedResource> = {}): CapturedResource {
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    sourceType: "youtube_video",
    sourceId: videoId,
    title: "Understanding Vector Databases",
    creator: "Some Channel",
    creatorId: "UC123",
    description: "A talk about embeddings and retrieval.",
    pageText: null,
    publishedAt: "2026-01-04",
    thumbnailUrl: null,
    ...overrides
  };
}

test("parses video ids from every supported YouTube URL shape", () => {
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${videoId}`), videoId);
  assert.equal(parseYouTubeVideoId(`https://youtube.com/watch?v=${videoId}&t=30s`), videoId);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${videoId}`), videoId);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${videoId}`), videoId);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/live/${videoId}`), videoId);
  assert.equal(parseYouTubeVideoId(`https://m.youtube.com/watch?v=${videoId}`), videoId);
});

test("rejects non-video YouTube URLs and other sites", () => {
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/@someChannel"), null);
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/channel/UC123"), null);
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/"), null);
  assert.equal(parseYouTubeVideoId("https://vimeo.com/12345"), null);
  assert.equal(parseYouTubeVideoId("not a url"), null);
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=tooshort"), null);
});

test("accepts a well-formed captured resource", () => {
  assert.doesNotThrow(() => assertCapturedResource(validResource()));
});

test("rejects a non-YouTube URL as unsupported", () => {
  assert.throws(
    () => assertCapturedResource(validResource({ url: "https://example.com/article" })),
    (error: AppError) => error.code === "UNSUPPORTED_RESOURCE"
  );
});

test("rejects a missing title instead of sending it to the AI", () => {
  assert.throws(
    () => assertCapturedResource(validResource({ title: "   " })),
    (error: AppError) => error.code === "PAGE_EXTRACTION_FAILED"
  );
});

// YouTube swaps video content without a page reload, so the DOM can describe a
// different video than the URL. This is the check that catches it.
test("rejects extracted metadata that belongs to a different video", () => {
  assert.throws(
    () => assertCapturedResource(validResource({ sourceId: "aaaaaaaaaaa" })),
    (error: AppError) => error.code === "PAGE_IDENTITY_MISMATCH"
  );
});

test("rejects a canonical link pointing at a different video", () => {
  assert.throws(
    () =>
      assertCapturedResource(
        validResource({ canonicalUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa" })
      ),
    (error: AppError) => error.code === "PAGE_IDENTITY_MISMATCH"
  );
});

test("rebuilds canonicalUrl from the verified video id", () => {
  const normalized = normalizeCapturedResource(validResource({ canonicalUrl: null }));
  assert.equal(normalized.canonicalUrl, canonicalYouTubeUrl(videoId));
});

test("normalizes blank optional fields to null", () => {
  const normalized = normalizeCapturedResource(
    validResource({ creator: "  ", description: "", publishedAt: "  " })
  );

  assert.equal(normalized.creator, null);
  assert.equal(normalized.description, null);
  assert.equal(normalized.publishedAt, null);
});

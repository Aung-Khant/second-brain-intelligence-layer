import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalYouTubeUrl,
  cleanYouTubeTitle,
  parseYouTubeChannelId,
  parseYouTubeVideoId
} from "../shared/capture/youtube.js";
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
  assert.equal(normalized.canonicalUrl, canonicalYouTubeUrl({ kind: "video", id: videoId }));
});

// A tab title carries an unread-notification badge and YouTube's own suffix.
// Neither belongs in Notion.
test("strips the unread count and the YouTube suffix from a title", () => {
  assert.equal(
    cleanYouTubeTitle("(87) The BRUTAL Curriculum That Produced 7 Minds - YouTube"),
    "The BRUTAL Curriculum That Produced 7 Minds"
  );
  assert.equal(cleanYouTubeTitle("(1) Something - YouTube"), "Something");
  assert.equal(cleanYouTubeTitle("A Clean Title"), "A Clean Title");
  // A parenthesised number that is part of the real title must survive.
  assert.equal(cleanYouTubeTitle("Episode 5 (2024) Review"), "Episode 5 (2024) Review");
  assert.equal(cleanYouTubeTitle("   "), null);
  assert.equal(cleanYouTubeTitle(null), null);
});

test("normalizing cleans the stored title", () => {
  const normalized = normalizeCapturedResource(
    validResource({ title: "(12) Real Title - YouTube" })
  );
  assert.equal(normalized.title, "Real Title");
});

test("parses channel URLs in all four addressing styles", () => {
  assert.equal(parseYouTubeChannelId("https://www.youtube.com/@PolyaMath"), "@PolyaMath");
  assert.equal(
    parseYouTubeChannelId("https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw"),
    "UCXuqSBlHAE6Xw-yeJA0Tunw"
  );
  assert.equal(parseYouTubeChannelId("https://www.youtube.com/c/Vanity"), "Vanity");
  assert.equal(parseYouTubeChannelId("https://www.youtube.com/user/Legacy"), "Legacy");
  assert.equal(parseYouTubeChannelId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
});

function channelResource(overrides: Record<string, unknown> = {}) {
  return {
    ...validResource(),
    url: "https://www.youtube.com/@PolyaMath",
    canonicalUrl: null,
    sourceType: "youtube_channel",
    sourceId: "@PolyaMath",
    title: "PolyaMath",
    ...overrides
  };
}

test("accepts a captured channel", () => {
  assert.doesNotThrow(() => assertCapturedResource(channelResource()));
});

// A handle and a UC id are both valid identities for the same channel and
// can't be compared, so this must not be rejected.
test("accepts a channel whose id is a UC id while the URL uses a handle", () => {
  assert.doesNotThrow(() =>
    assertCapturedResource(channelResource({ sourceId: "UCXuqSBlHAE6Xw-yeJA0Tunw" }))
  );
});

// The real-world failure: YouTube is a single-page app, so ytInitialData can
// still describe the previous channel after navigating to a new one.
test("rejects one channel's metadata captured under another channel's URL", () => {
  assert.throws(
    () =>
      assertCapturedResource(
        channelResource({ url: "https://www.youtube.com/@Newsthink", sourceId: "@PolyaMath" })
      ),
    (error: AppError) => error.code === "PAGE_IDENTITY_MISMATCH"
  );
});

test("matches channel handles case-insensitively", () => {
  assert.doesNotThrow(() =>
    assertCapturedResource(
      channelResource({ url: "https://www.youtube.com/@polyamath", sourceId: "@PolyaMath" })
    )
  );
});

// A channel URL with video metadata (or the reverse) means the capture raced
// a navigation.
test("rejects a channel URL captured as a video", () => {
  assert.throws(
    () =>
      assertCapturedResource({
        ...validResource(),
        url: "https://www.youtube.com/@PolyaMath",
        sourceType: "youtube_video"
      }),
    (error: AppError) => error.code === "PAGE_IDENTITY_MISMATCH"
  );
});

test("normalizes blank optional fields to null", () => {
  const normalized = normalizeCapturedResource(
    validResource({ creator: "  ", description: "", publishedAt: "  " })
  );

  assert.equal(normalized.creator, null);
  assert.equal(normalized.description, null);
  assert.equal(normalized.publishedAt, null);
});

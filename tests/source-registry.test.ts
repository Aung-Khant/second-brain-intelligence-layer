// Covers the capture registry itself, separately from any one adapter. These
// are the guarantees the rest of the pipeline is built on: detection is
// deterministic, precedence is defined, and a source type without an adapter
// fails loudly instead of writing a Notion Type that doesn't exist.
import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalUrlFor,
  detectSource,
  isSupportedSourceType,
  notionTypeFor
} from "../shared/capture/source.js";
import { AppError } from "../shared/types/errors.js";

test("detects YouTube videos across every supported URL shape", () => {
  const shapes = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ"
  ];

  for (const url of shapes) {
    assert.deepEqual(detectSource(url), { sourceType: "youtube_video", id: "dQw4w9WgXcQ" }, url);
  }
});

test("detects YouTube channels across every supported URL shape", () => {
  assert.deepEqual(detectSource("https://www.youtube.com/@PolyaMath"), {
    sourceType: "youtube_channel",
    id: "@PolyaMath"
  });
  assert.deepEqual(detectSource("https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw"), {
    sourceType: "youtube_channel",
    id: "UCXuqSBlHAE6Xw-yeJA0Tunw"
  });
});

// Videos are checked before channels, so a /watch URL is never mistaken for a
// channel just because both live on youtube.com.
test("prefers the more specific adapter when both could match", () => {
  assert.equal(detectSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.sourceType, "youtube_video");
});

test("claims nothing it cannot yet handle", () => {
  const unclaimed = [
    "https://github.com/anthropics/claude-code",
    "https://arxiv.org/abs/1706.03762",
    "https://example.com/some/article",
    "not a url",
    // Non-http schemes must never reach an extractor.
    "javascript:alert(1)",
    "file:///etc/passwd",
    "chrome://extensions"
  ];

  for (const url of unclaimed) {
    assert.equal(detectSource(url), null, url);
  }
});

test("rebuilds a canonical URL from the detected identity", () => {
  assert.equal(
    canonicalUrlFor({ sourceType: "youtube_video", id: "dQw4w9WgXcQ" }),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  assert.equal(
    canonicalUrlFor({ sourceType: "youtube_channel", id: "@PolyaMath" }),
    "https://www.youtube.com/@PolyaMath"
  );
});

test("maps only source types that have an adapter", () => {
  assert.equal(notionTypeFor("youtube_video"), "Video");
  assert.equal(notionTypeFor("youtube_channel"), "YouTube Channel");
  assert.equal(isSupportedSourceType("youtube_video"), true);
  assert.equal(isSupportedSourceType("github_repo"), false);
  assert.equal(isSupportedSourceType("nonsense"), false);
});

// The union in captured-resource.ts lists types the pipeline is being built
// toward. Reaching Notion with one that has no adapter would send a Type the
// database has no option for, which is a hard 400 - so it must throw first.
test("refuses to map a source type that has no adapter yet", () => {
  assert.throws(
    () => notionTypeFor("github_repo"),
    (error: AppError) => error.code === "UNSUPPORTED_RESOURCE"
  );
});

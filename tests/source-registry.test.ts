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
  notionTypeFor,
  sourceTypeIsAccepted
} from "../shared/capture/source.js";

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

test("detects GitHub repositories, and only real ones", () => {
  assert.deepEqual(detectSource("https://github.com/anthropics/claude-code"), {
    sourceType: "github_repo",
    id: "anthropics/claude-code"
  });
  // A URL deep inside a repo still identifies the repo.
  assert.equal(
    detectSource("https://github.com/anthropics/claude-code/blob/main/README.md")?.id,
    "anthropics/claude-code"
  );
  // GitHub's own pages are not anybody's repository.
  for (const url of [
    "https://github.com/features/copilot",
    "https://github.com/pricing",
    "https://github.com/anthropics"
  ]) {
    assert.notEqual(detectSource(url)?.sourceType, "github_repo", url);
  }
});

test("detects research papers and normalises arXiv ids", () => {
  assert.deepEqual(detectSource("https://arxiv.org/abs/1706.03762"), {
    sourceType: "research_paper",
    id: "arxiv:1706.03762"
  });
  // A version suffix is the same paper.
  assert.equal(detectSource("https://arxiv.org/abs/1706.03762v5")?.id, "arxiv:1706.03762");
  // A PDF is the same paper too, and canonicalises to the readable page.
  assert.equal(detectSource("https://arxiv.org/pdf/1706.03762.pdf")?.id, "arxiv:1706.03762");
  assert.equal(detectSource("https://doi.org/10.1038/nature14539")?.sourceType, "research_paper");
});

test("falls back to the webpage adapter for anything else", () => {
  assert.deepEqual(detectSource("https://example.com/some/article"), {
    sourceType: "website",
    id: null
  });
});

test("claims nothing that is not a real web page", () => {
  const unclaimed = [
    "not a url",
    // Non-http schemes must never reach an extractor.
    "javascript:alert(1)",
    "file:///etc/passwd",
    "chrome://extensions",
    // Saving the extension's own backend is never what you meant.
    "http://127.0.0.1:3737/health",
    "http://localhost:3737/health"
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
  assert.equal(
    canonicalUrlFor({ sourceType: "github_repo", id: "anthropics/claude-code" }),
    "https://github.com/anthropics/claude-code"
  );
  // A PDF has no DOM, so the abstract page is the capturable form of it.
  assert.equal(
    canonicalUrlFor({ sourceType: "research_paper", id: "arxiv:1706.03762" }),
    "https://arxiv.org/abs/1706.03762"
  );
  // A general page has no identity beyond its URL, so there is nothing to rebuild.
  assert.equal(canonicalUrlFor({ sourceType: "website", id: null }), null);
});

// Every value here must be an option that exists in the Notion Type select.
// Sending one that does not is a hard 400, not a silent no-op.
test("maps every source type onto an existing Notion Type option", () => {
  const existingNotionOptions = new Set([
    "Article",
    "Video",
    "YouTube Channel",
    "Website",
    "PDF"
  ]);

  for (const sourceType of [
    "youtube_video",
    "youtube_channel",
    "github_repo",
    "article",
    "website",
    "research_paper"
  ] as const) {
    const notionType = notionTypeFor(sourceType);
    assert.ok(
      existingNotionOptions.has(notionType),
      `${sourceType} maps to "${notionType}", which is not an option in the Type select`
    );
  }
});

test("recognises every supported source type and nothing else", () => {
  for (const sourceType of ["youtube_video", "github_repo", "article", "website"]) {
    assert.equal(isSupportedSourceType(sourceType), true, sourceType);
  }
  assert.equal(isSupportedSourceType("nonsense"), false);
});

// article and website share a URL shape and are told apart by page signals, so
// the extractor is allowed to refine what the URL guessed. No other pair is.
test("lets a generic page be captured as either an article or a website", () => {
  const detected = { sourceType: "website", id: null } as const;
  assert.equal(sourceTypeIsAccepted("website", detected), true);
  assert.equal(sourceTypeIsAccepted("article", detected), true);
  assert.equal(sourceTypeIsAccepted("youtube_video", detected), false);

  const video = { sourceType: "youtube_video", id: "dQw4w9WgXcQ" } as const;
  assert.equal(sourceTypeIsAccepted("article", video), false);
});

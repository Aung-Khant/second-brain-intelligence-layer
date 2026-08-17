import test from "node:test";
import assert from "node:assert/strict";
import {
  clearNotionTaxonomyCache,
  fetchNotionTaxonomy,
  readNotionTaxonomyCacheStatus
} from "../backend/src/notion/taxonomy.js";

test("caches Notion taxonomy fetches within the TTL", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  let calls = 0;

  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.NOTION_TAXONOMY_CACHE_TTL_MS = "600000";
  clearNotionTaxonomyCache();

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        results: [],
        has_more: false,
        next_cursor: null
      }),
      { status: 200 }
    );
  };

  try {
    await fetchNotionTaxonomy();
    await fetchNotionTaxonomy();

    assert.equal(calls, 3);
    assert.equal(readNotionTaxonomyCacheStatus().cached, true);
  } finally {
    clearNotionTaxonomyCache();
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

test("can disable Notion taxonomy cache with zero TTL", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  let calls = 0;

  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.NOTION_TAXONOMY_CACHE_TTL_MS = "0";
  clearNotionTaxonomyCache();

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        results: [],
        has_more: false,
        next_cursor: null
      }),
      { status: 200 }
    );
  };

  try {
    await fetchNotionTaxonomy();
    await fetchNotionTaxonomy();

    assert.equal(calls, 6);
    assert.equal(readNotionTaxonomyCacheStatus().ttlMs, 0);
  } finally {
    clearNotionTaxonomyCache();
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

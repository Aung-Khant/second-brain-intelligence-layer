import test from "node:test";
import assert from "node:assert/strict";
import {
  clearNotionTaxonomyCache,
  fetchNotionTaxonomy,
  readNotionTaxonomyCacheStatus
} from "../backend/src/notion/taxonomy.js";

// The cache is keyed by connection id now, so every call needs a config. This
// mirrors what the env fallback produces.
function testConfig(connectionId = "local") {
  return {
    apiKey: process.env.NOTION_API_KEY ?? "test-key",
    notionVersion: "2026-03-11",
    connectionId,
    areasDataSourceId: process.env.NOTION_AREAS_DATA_SOURCE_ID ?? "areas-ds",
    topicsDataSourceId: process.env.NOTION_TOPICS_DATA_SOURCE_ID ?? "topics-ds",
    projectsDataSourceId: process.env.NOTION_PROJECTS_DATA_SOURCE_ID ?? "projects-ds",
    resourcesDataSourceId: process.env.NOTION_RESOURCES_DATA_SOURCE_ID ?? "resources-ds"
  };
}

test("caches Notion taxonomy fetches within the TTL", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  let calls = 0;

  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.NOTION_AREAS_DATA_SOURCE_ID = "areas-ds";
  process.env.NOTION_TOPICS_DATA_SOURCE_ID = "topics-ds";
  process.env.NOTION_PROJECTS_DATA_SOURCE_ID = "projects-ds";
  process.env.NOTION_RESOURCES_DATA_SOURCE_ID = "resources-ds";
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
    await fetchNotionTaxonomy(testConfig());
    await fetchNotionTaxonomy(testConfig());

    assert.equal(calls, 3);
    assert.equal(readNotionTaxonomyCacheStatus().cachedConnections, 1);
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
  process.env.NOTION_AREAS_DATA_SOURCE_ID = "areas-ds";
  process.env.NOTION_TOPICS_DATA_SOURCE_ID = "topics-ds";
  process.env.NOTION_PROJECTS_DATA_SOURCE_ID = "projects-ds";
  process.env.NOTION_RESOURCES_DATA_SOURCE_ID = "resources-ds";
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
    await fetchNotionTaxonomy(testConfig());
    await fetchNotionTaxonomy(testConfig());

    assert.equal(calls, 6);
    assert.equal(readNotionTaxonomyCacheStatus().ttlMs, 0);
  } finally {
    clearNotionTaxonomyCache();
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

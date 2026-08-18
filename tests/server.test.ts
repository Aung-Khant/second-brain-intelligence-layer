import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../backend/src/server/dev-server.js";

test("health endpoint reports the local API is available", async () => {
  const response = await handleApiRequest("GET", "/health");

  assert.equal(response.statusCode, 200);
  assert.equal(isRecord(response.body) && response.body.ok, true);
  assert.equal(isRecord(response.body) && response.body.service, "second-brain-intelligence-layer");
  assert.equal(
    isRecord(response.body) &&
      isRecord(response.body.notionTaxonomyCache) &&
      typeof response.body.notionTaxonomyCache.ttlMs,
    "number"
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("unknown endpoint returns a structured error", async () => {
  const response = await handleApiRequest("GET", "/missing");

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    error: {
      code: "NOT_FOUND",
      message: "Route not found."
    }
  });
});

test("classify endpoint uses local matching for instant results", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;

  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.NOTION_TAXONOMY_CACHE_TTL_MS = "0";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [],
        has_more: false,
        next_cursor: null
      }),
      { status: 200 }
    );

  try {
    const response = await handleApiRequest("POST", "/api/classify", {
      resource: {
        title: "Example",
        url: "https://example.com",
        type: "webpage"
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      isRecord(response.body) &&
        isRecord(response.body.classification) &&
        response.body.classification.engine,
      "local"
    );
  } finally {
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

test("taxonomy endpoint returns picker data from Notion taxonomy", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;

  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.NOTION_TAXONOMY_CACHE_TTL_MS = "0";

  globalThis.fetch = async (input) => {
    const url = String(input);
    const title =
      url.includes("048d5cf2")
        ? "Computer Science & AI"
        : url.includes("4c1d5cf2")
          ? "Python"
          : "Learn Python";

    return new Response(
      JSON.stringify({
        results: [
          {
            id: `${title.toLowerCase().replaceAll(" ", "-")}-id`,
            url: "https://notion.so/test",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: title }]
              }
            }
          }
        ],
        has_more: false,
        next_cursor: null
      }),
      { status: 200 }
    );
  };

  try {
    const response = await handleApiRequest("GET", "/api/taxonomy");
    assert.equal(response.statusCode, 200);
    assert.equal(
      isRecord(response.body) &&
        isRecord(response.body.taxonomy) &&
        Array.isArray(response.body.taxonomy.areas),
      true
    );
  } finally {
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

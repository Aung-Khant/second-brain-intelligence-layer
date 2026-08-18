import test from "node:test";
import assert from "node:assert/strict";
import { assertConfirmedResource } from "../shared/schemas/save-validation.js";
import { normalizeResourceUrl, urlsMatch } from "../backend/src/notion/url.js";
import { saveResourceToNotion } from "../backend/src/notion/save-resource.js";

test("normalizes resource URLs for duplicate detection", () => {
  assert.equal(
    normalizeResourceUrl("https://Example.com/path/?utm_source=x&utm_campaign=y#section"),
    "https://example.com/path"
  );
});

test("matches URLs after removing tracking parameters and fragments", () => {
  assert.equal(
    urlsMatch(
      "https://github.com/Asabeneh/30-Days-Of-Python?utm_source=newsletter#readme",
      "https://github.com/Asabeneh/30-Days-Of-Python"
    ),
    true
  );
});

test("accepts missing optional Why Saved", () => {
  assert.doesNotThrow(() =>
    assertConfirmedResource({
      name: "30 Days Of Python",
      url: "https://github.com/Asabeneh/30-Days-Of-Python",
      resourceType: "webpage",
      areaIds: [],
      topicIds: [],
      projectIds: [],
      saveIntent: "learn"
    })
  );
});

test("requires Save Intent", () => {
  assert.throws(
    () =>
      assertConfirmedResource({
        name: "30 Days Of Python",
        url: "https://github.com/Asabeneh/30-Days-Of-Python",
        resourceType: "webpage",
        areaIds: [],
        topicIds: [],
        projectIds: []
      }),
    /Save Intent is required/
  );
});

test("writes the description under the correctly spelled Description property", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  let createBody: Record<string, unknown> | undefined;

  process.env.NOTION_API_KEY = "test-notion-key";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/pages")) {
      createBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ id: "resource-page-id", url: "https://notion.so/resource-page-id" }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
      status: 200
    });
  };

  try {
    await saveResourceToNotion({
      name: "30 Days Of Python",
      url: "https://github.com/Asabeneh/30-Days-Of-Python",
      resourceType: "webpage",
      summary: "A 30 day Python learning challenge.",
      areaIds: [],
      topicIds: [],
      projectIds: [],
      saveIntent: "learn"
    });

    const properties = createBody?.properties;
    assert.equal(isRecord(properties) && Object.hasOwn(properties, "Description"), true);
    assert.equal(isRecord(properties) && Object.hasOwn(properties, "Descriptioin"), false);
  } finally {
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

test("rejects unsupported saved resource types", () => {
  assert.throws(
    () =>
      assertConfirmedResource({
        name: "PDF Resource",
        url: "https://example.com/file.pdf",
        resourceType: "pdf",
        areaIds: [],
        topicIds: [],
        projectIds: [],
        saveIntent: "reference"
      }),
    /Unsupported confirmed resource type/
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../backend/src/server/dev-server.js";
import { clearNotionTaxonomyCache } from "../backend/src/notion/taxonomy.js";

test("creates a Topic page with default template properties", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  process.env.NOTION_API_KEY = "test-notion-key";
  clearNotionTaxonomyCache();

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "topic-page-id",
        url: "https://notion.so/topic-page-id"
      }),
      { status: 200 }
    );
  };

  try {
    const response = await handleApiRequest("POST", "/api/topics", {
      name: "Calculus",
      areaId: "area-math",
      areaName: "Mathematics & Science",
      reason: "Useful topic for calculus videos."
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      topic: {
        id: "topic-page-id",
        name: "Calculus",
        url: "https://notion.so/topic-page-id",
        areaId: "area-math",
        areaName: "Mathematics & Science"
      }
    });
    assert.equal(requestBody?.template && isRecord(requestBody.template) && requestBody.template.type, "default");
    assert.equal(
      requestBody?.properties &&
        isRecord(requestBody.properties) &&
        isRecord(requestBody.properties.Name),
      true
    );
    assert.equal(
      requestBody?.properties &&
        isRecord(requestBody.properties) &&
        Object.hasOwn(requestBody.properties, "Definition"),
      false
    );
    assert.equal(
      requestBody?.properties &&
        isRecord(requestBody.properties) &&
        Object.hasOwn(requestBody.properties, "Areas"),
      false
    );
  } finally {
    clearNotionTaxonomyCache();
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

test("returns the Notion create error detail when Topic creation fails", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;

  process.env.NOTION_API_KEY = "test-notion-key";
  clearNotionTaxonomyCache();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        object: "error",
        code: "validation_error",
        message: "Cannot apply default template because no default template is configured."
      }),
      { status: 400 }
    );

  try {
    const response = await handleApiRequest("POST", "/api/topics", {
      name: "AI-assisted Learning",
      areaId: "area-learning",
      areaName: "Learning & Cognitive Science"
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
      isRecord(response.body) &&
        isRecord(response.body.error) &&
        String(response.body.error.message).includes("Cannot apply default template"),
      true
    );
  } finally {
    clearNotionTaxonomyCache();
    process.env = previousEnv;
    globalThis.fetch = previousFetch;
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

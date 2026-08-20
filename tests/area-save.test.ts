import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../backend/src/server/dev-server.js";
import { clearNotionTaxonomyCache } from "../backend/src/notion/taxonomy.js";

test("creates an Area page with the default template", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  process.env.NOTION_API_KEY = "test-notion-key";
  // The four data source ids used to have hardcoded fallbacks pointing at one

  // specific demo workspace, which is what made this single-user. They are

  // required now, so tests state them explicitly.

  process.env.NOTION_AREAS_DATA_SOURCE_ID = "areas-ds";

  process.env.NOTION_TOPICS_DATA_SOURCE_ID = "topics-ds";

  process.env.NOTION_PROJECTS_DATA_SOURCE_ID = "projects-ds";

  process.env.NOTION_RESOURCES_DATA_SOURCE_ID = "resources-ds";
  clearNotionTaxonomyCache();

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: "area-page-id",
        url: "https://notion.so/area-page-id"
      }),
      { status: 200 }
    );
  };

  try {
    const response = await handleApiRequest("POST", "/api/areas", {
      name: "Digital Tools"
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      area: {
        id: "area-page-id",
        name: "Digital Tools",
        url: "https://notion.so/area-page-id"
      }
    });
    assert.equal(requestBody?.template && isRecord(requestBody.template) && requestBody.template.type, "default");
    assert.equal(
      requestBody?.properties &&
        isRecord(requestBody.properties) &&
        isRecord(requestBody.properties.Name),
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

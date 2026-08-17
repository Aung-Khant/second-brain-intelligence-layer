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

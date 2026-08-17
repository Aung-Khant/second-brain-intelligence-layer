import test from "node:test";
import assert from "node:assert/strict";
import { handleApiRequest } from "../backend/src/server/dev-server.js";

test("health endpoint reports the local API is available", async () => {
  const response = await handleApiRequest("GET", "/health");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    service: "second-brain-intelligence-layer"
  });
});

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

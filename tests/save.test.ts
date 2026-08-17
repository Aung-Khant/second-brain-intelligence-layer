import test from "node:test";
import assert from "node:assert/strict";
import { assertConfirmedResource } from "../shared/schemas/save-validation.js";
import { normalizeResourceUrl, urlsMatch } from "../backend/src/notion/url.js";

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


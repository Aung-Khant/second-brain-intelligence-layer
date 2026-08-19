import assert from "node:assert/strict";
import test from "node:test";
import { buildCorrectionRecords } from "../backend/src/v1/corrections.js";
import { selectionStateFor } from "../backend/src/v1/api.js";
import type { ClassificationResult } from "../shared/types/captured-resource.js";

const classification: ClassificationResult = {
  areas: [{ id: "area-cs", name: "Computer Science", confidence: 0.97, reason: "Directly about retrieval." }],
  projects: [
    {
      id: "project-sbil",
      name: "Second Brain Intelligence Layer",
      confidence: 0.92,
      reason: "Feeds this build."
    }
  ],
  topics: [
    { id: "topic-retrieval", name: "Retrieval", confidence: 0.96, reason: "Core subject." },
    { id: "topic-llms", name: "LLMs", confidence: 0.58, reason: "Mentioned only." }
  ]
};

// The suggest floor was raised from the spec's 0.70 to 0.80: at 0.70 the
// classifier surfaced tangential matches the user had to read and dismiss,
// which costs more attention than a missed suggestion costs recall.
test("maps confidence onto the three selection bands", () => {
  assert.equal(selectionStateFor(0.97), "auto_selected");
  assert.equal(selectionStateFor(0.9), "auto_selected");
  assert.equal(selectionStateFor(0.89), "suggested");
  assert.equal(selectionStateFor(0.8), "suggested");
  assert.equal(selectionStateFor(0.79), "unselected");
  assert.equal(selectionStateFor(0.58), "unselected");
});

// This is the exact scenario from the MVP spec's expected success case.
test("records accepted, rejected, and manually added decisions", () => {
  const records = buildCorrectionRecords({
    resourceId: "notion-page-1",
    resourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    classification,
    selection: {
      areaIds: ["area-cs"],
      projectIds: ["project-sbil"],
      topicIds: ["topic-retrieval", "topic-embeddings"]
    },
    entityNamesById: new Map([["topic-embeddings", "Embeddings"]])
  });

  const byEntity = new Map(records.map((record) => [record.entityId, record]));

  assert.equal(byEntity.get("area-cs")?.action, "accepted");
  assert.equal(byEntity.get("project-sbil")?.action, "accepted");
  assert.equal(byEntity.get("topic-retrieval")?.action, "accepted");

  const rejected = byEntity.get("topic-llms");
  assert.equal(rejected?.action, "rejected");
  assert.equal(rejected?.aiSuggested, true);
  assert.equal(rejected?.userAccepted, false);
  assert.equal(rejected?.aiConfidence, 0.58);

  const added = byEntity.get("topic-embeddings");
  assert.equal(added?.action, "manually_added");
  assert.equal(added?.aiSuggested, false);
  assert.equal(added?.userAccepted, true);
  assert.equal(added?.aiConfidence, null);
  assert.equal(added?.entityName, "Embeddings");
});

test("records nothing when there were no suggestions and no selections", () => {
  const records = buildCorrectionRecords({
    resourceId: "notion-page-2",
    resourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    classification: { areas: [], projects: [], topics: [] },
    selection: { areaIds: [], projectIds: [], topicIds: [] },
    entityNamesById: new Map()
  });

  assert.equal(records.length, 0);
});

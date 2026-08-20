import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendCorrectionRecords,
  buildCorrectionRecords,
  deleteCorrectionsForConnection,
  retrieveRelevantCorrections
} from "../backend/src/v1/corrections.js";
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
    connectionId: "conn-test",
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
    connectionId: "conn-test",
    resourceId: "notion-page-2",
    resourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    classification: { areas: [], projects: [], topics: [] },
    selection: { areaIds: [], projectIds: [], topicIds: [] },
    entityNamesById: new Map()
  });

  assert.equal(records.length, 0);
});

async function withLogFile<T>(run: (path: string) => Promise<T>): Promise<T> {
  const previous = process.env.CORRECTIONS_LOG_PATH;
  const directory = await mkdtemp(join(tmpdir(), "sbil-corrections-"));
  const path = join(directory, "corrections.jsonl");
  process.env.CORRECTIONS_LOG_PATH = path;

  try {
    return await run(path);
  } finally {
    if (previous === undefined) delete process.env.CORRECTIONS_LOG_PATH;
    else process.env.CORRECTIONS_LOG_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("retrieval only ever sees one connection's own corrections", async () => {
  await withLogFile(async () => {
    await appendCorrectionRecords(
      buildCorrectionRecords({
        connectionId: "conn-alice",
        resourceId: "r1",
        resourceUrl: "https://example.com/1",
        classification: { areas: [], projects: [], topics: [] },
        selection: { areaIds: [], projectIds: [], topicIds: ["topic-x"] },
        entityNamesById: new Map([["topic-x", "Retrieval"]])
      })
    );
    await appendCorrectionRecords(
      buildCorrectionRecords({
        connectionId: "conn-bob",
        resourceId: "r2",
        resourceUrl: "https://example.com/2",
        classification: { areas: [], projects: [], topics: [] },
        selection: { areaIds: [], projectIds: [], topicIds: ["topic-x"] },
        entityNamesById: new Map([["topic-x", "Retrieval"]])
      })
    );

    const understanding = {
      summary: "A video about retrieval systems.",
      coreIdeas: ["retrieval"],
      likelyUseCases: [],
      contentCategory: "video"
    };

    const aliceHints = await retrieveRelevantCorrections(understanding, "conn-alice");
    const bobHints = await retrieveRelevantCorrections(understanding, "conn-bob");
    const strangerHints = await retrieveRelevantCorrections(understanding, "conn-nobody");

    assert.equal(aliceHints.length, 1);
    assert.equal(bobHints.length, 1);
    assert.equal(strangerHints.length, 0);
  });
});

// The disconnect guarantee on the corrections side: deleting one connection's
// data must not touch anyone else's history sharing the same log file.
test("deleting a connection's corrections leaves other connections intact", async () => {
  await withLogFile(async (path) => {
    await appendCorrectionRecords(
      buildCorrectionRecords({
        connectionId: "conn-alice",
        resourceId: "r1",
        resourceUrl: "https://example.com/1",
        classification: { areas: [], projects: [], topics: [] },
        selection: { areaIds: [], projectIds: [], topicIds: ["topic-x"] },
        entityNamesById: new Map([["topic-x", "Retrieval"]])
      })
    );
    await appendCorrectionRecords(
      buildCorrectionRecords({
        connectionId: "conn-bob",
        resourceId: "r2",
        resourceUrl: "https://example.com/2",
        classification: { areas: [], projects: [], topics: [] },
        selection: { areaIds: [], projectIds: [], topicIds: ["topic-y"] },
        entityNamesById: new Map([["topic-y", "Chemistry"]])
      })
    );

    await deleteCorrectionsForConnection("conn-alice");

    const onDisk = await readFile(path, "utf8");
    assert.ok(!onDisk.includes("conn-alice"), "alice's data survived deletion");
    assert.ok(onDisk.includes("conn-bob"), "bob's data was deleted along with alice's");
  });
});

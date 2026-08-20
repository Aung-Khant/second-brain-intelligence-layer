// Step 8 + 9. Records what the AI suggested against what the user actually
// chose, one row per entity, in backend storage only - never in Notion. Notion
// holds clean knowledge; this file holds the evidence of how the user thinks.
//
// Storage is a JSONL append, matching the existing classification-logs
// convention. The retrieval interface below is the seam for real relevance
// ranking later; right now it does keyword overlap on purpose, so the vertical
// slice works without an embedding store.
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ClassificationCandidate,
  ClassificationResult,
  CorrectionAction,
  CorrectionRecord,
  EntityType,
  ResourceUnderstanding
} from "../../../shared/types/captured-resource.js";

export type FinalSelection = {
  areaIds: string[];
  projectIds: string[];
  topicIds: string[];
};

export type CorrectionHint = {
  summary: string;
};

const logDirectory = "correction-logs";
const logFileName = "corrections.jsonl";

// Overridable so tests can point this at a throwaway directory instead of the
// real project log - the same reasoning as CONNECTIONS_STORE_PATH.
function logFilePath(): string {
  return process.env.CORRECTIONS_LOG_PATH || join(process.cwd(), logDirectory, logFileName);
}

export function buildCorrectionRecords(input: {
  connectionId: string;
  resourceId: string;
  resourceUrl: string;
  classification: ClassificationResult;
  selection: FinalSelection;
  entityNamesById: Map<string, string>;
}): CorrectionRecord[] {
  const timestamp = new Date().toISOString();

  return [
    ...recordsFor("area", input.classification.areas, input.selection.areaIds),
    ...recordsFor("project", input.classification.projects, input.selection.projectIds),
    ...recordsFor("topic", input.classification.topics, input.selection.topicIds)
  ];

  function recordsFor(
    entityType: EntityType,
    candidates: ClassificationCandidate[],
    selectedIds: string[]
  ): CorrectionRecord[] {
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const selected = new Set(selectedIds);
    const records: CorrectionRecord[] = [];

    for (const candidate of candidates) {
      const userAccepted = selected.has(candidate.id);
      records.push({
        connectionId: input.connectionId,
        resourceId: input.resourceId,
        resourceUrl: input.resourceUrl,
        entityType,
        entityId: candidate.id,
        entityName: candidate.name,
        aiConfidence: candidate.confidence,
        aiSuggested: true,
        userAccepted,
        action: userAccepted ? "accepted" : "rejected",
        timestamp
      });
    }

    for (const entityId of selectedIds) {
      if (candidatesById.has(entityId)) continue;
      records.push({
        connectionId: input.connectionId,
        resourceId: input.resourceId,
        resourceUrl: input.resourceUrl,
        entityType,
        entityId,
        entityName: input.entityNamesById.get(entityId) ?? entityId,
        aiConfidence: null,
        aiSuggested: false,
        userAccepted: true,
        action: "manually_added" satisfies CorrectionAction,
        timestamp
      });
    }

    return records;
  }
}

export async function appendCorrectionRecords(records: CorrectionRecord[]): Promise<void> {
  if (records.length === 0) return;

  const path = logFilePath();
  await mkdir(dirname(path), { recursive: true });

  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await appendFile(path, `${lines}\n`);
}

// Step 9's interface. Deliberately keyword-based: the point right now is that
// classify.ts has somewhere real to call, not that the ranking is good. Swap
// the body for embedding search later without touching the classifier.
// Corrections are scoped to one connection. Feeding one person's history into
// another person's classifier would leak how they think about their own
// workspace, and would make the suggestions worse besides - these are
// judgements about a specific taxonomy, not general knowledge.
export async function retrieveRelevantCorrections(
  understanding: ResourceUnderstanding,
  connectionId: string,
  limit = 5
): Promise<CorrectionHint[]> {
  const all = await readCorrectionRecords();
  const records = all.filter((record) => record.connectionId === connectionId);
  if (records.length === 0) return [];

  const terms = new Set(
    [understanding.summary, ...understanding.coreIdeas]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3)
  );

  const scored = records
    .filter((record) => record.action !== "accepted" || record.aiConfidence !== null)
    .map((record) => ({
      record,
      score: overlapScore(record.entityName, terms)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ record }) => ({
    summary: describeCorrection(record)
  }));
}

function describeCorrection(record: CorrectionRecord): string {
  if (record.action === "manually_added") {
    return `The user added ${record.entityType} "${record.entityName}" themselves when it was not suggested.`;
  }

  const confidence = record.aiConfidence?.toFixed(2) ?? "unknown";
  return record.action === "accepted"
    ? `The user kept ${record.entityType} "${record.entityName}" (suggested at ${confidence}).`
    : `The user removed ${record.entityType} "${record.entityName}" (suggested at ${confidence}).`;
}

function overlapScore(entityName: string, terms: Set<string>): number {
  const words = entityName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.reduce((score, word) => (terms.has(word) ? score + 1 : score), 0);
}

// Called from disconnect. Disconnecting is meant to leave no trace, so this
// physically rewrites the file rather than marking rows deleted - there is no
// "soft delete" here for someone to recover from.
export async function deleteCorrectionsForConnection(connectionId: string): Promise<void> {
  const all = await readCorrectionRecords();
  const remaining = all.filter((record) => record.connectionId !== connectionId);
  if (remaining.length === all.length) return;

  const path = logFilePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const lines = remaining.map((record) => JSON.stringify(record)).join("\n");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, remaining.length ? `${lines}\n` : "");
  await rename(temporaryPath, path);
}

async function readCorrectionRecords(): Promise<CorrectionRecord[]> {
  try {
    const contents = await readFile(logFilePath(), "utf8");
    return contents
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => safeParse(line))
      .filter((record): record is CorrectionRecord => record !== undefined);
  } catch {
    return [];
  }
}

function safeParse(line: string): CorrectionRecord | undefined {
  try {
    return JSON.parse(line) as CorrectionRecord;
  } catch {
    return undefined;
  }
}

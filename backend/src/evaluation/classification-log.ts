// Appends one JSON line per successful save to
// classification-logs/classification.jsonl (gitignored, local only),
// recording what the classifier/AI suggested vs. what the user actually
// picked. Not read anywhere yet in-app - it's a data trail for later
// measuring how good the suggestions actually are in practice.
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { classifierConfig } from "../config/classification.js";

export type ClassificationLog = {
  resourceUrl: string;
  model: string;
  classifierVersion: string;
  aiSuggestion: {
    areas: string[];
    topics: string[];
    projects: string[];
  };
  finalSelection: {
    areas: string[];
    topics: string[];
    projects: string[];
  };
  timestamp: string;
};

export async function appendClassificationLog(
  log: Omit<ClassificationLog, "timestamp" | "classifierVersion">
): Promise<void> {
  const directory = join(process.cwd(), "classification-logs");
  await mkdir(directory, { recursive: true });

  const entry: ClassificationLog = {
    ...log,
    classifierVersion: classifierConfig.version,
    timestamp: new Date().toISOString()
  };

  await appendFile(join(directory, "classification.jsonl"), `${JSON.stringify(entry)}\n`);
}


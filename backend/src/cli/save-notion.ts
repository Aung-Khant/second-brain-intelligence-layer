import { assertConfirmedResource } from "../../../shared/schemas/save-validation.js";
import type { ConfirmedResource } from "../../../shared/types/save.js";
import { loadDotEnv } from "../config/env.js";
import { appendClassificationLog } from "../evaluation/classification-log.js";
import { checkDuplicateResourceInNotion, saveResourceToNotion } from "../notion/save-resource.js";
import { readJsonArgumentOrStdin } from "./read-json.js";

type SaveCliInput = {
  resource: ConfirmedResource;
  aiSuggestion?: {
    areas: string[];
    topics: string[];
    projects: string[];
  };
};

loadDotEnv();

const confirmWrite = process.argv.includes("--confirm-write");
const input = (await readJsonArgumentOrStdin()) as SaveCliInput;
assertConfirmedResource(input.resource);

const duplicate = await checkDuplicateResourceInNotion(input.resource.url);

if (duplicate) {
  process.stdout.write(
    `${JSON.stringify(
      { status: "duplicate", resourceId: duplicate.id, resourceUrl: duplicate.url },
      null,
      2
    )}\n`
  );
  process.exit(0);
}

if (!confirmWrite) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "dry_run",
        message: "No Resource was created. Re-run with --confirm-write to save into Notion.",
        resource: input.resource
      },
      null,
      2
    )}\n`
  );
  process.exit(0);
}

const result = await saveResourceToNotion(input.resource);

if (result.status === "saved") {
  await appendClassificationLog({
    resourceUrl: input.resource.url,
    model: "local-classifier",
    aiSuggestion: input.aiSuggestion ?? {
      areas: input.resource.areaIds,
      topics: input.resource.topicIds,
      projects: input.resource.projectIds
    },
    finalSelection: {
      areas: input.resource.areaIds,
      topics: input.resource.topicIds,
      projects: input.resource.projectIds
    }
  });
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);


// CLI: `npm run classify:notion -- <file.json>`. Same as classify.ts but
// against your real, live Notion Areas/Topics/Projects instead of the mock
// taxonomy - requires NOTION_API_KEY in .env.
import { classifyResource } from "../ai/classify-resource.js";
import { loadDotEnv } from "../config/env.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";
import { readJsonArgumentOrStdin } from "./read-json.js";
import type { TrustedResourceInput } from "../../../shared/types/resource.js";

type CliInput = {
  resource: TrustedResourceInput;
};

loadDotEnv();

const input = (await readJsonArgumentOrStdin()) as CliInput;
const taxonomy = await fetchNotionTaxonomy();
const output = classifyResource({
  resource: input.resource,
  taxonomy
});

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

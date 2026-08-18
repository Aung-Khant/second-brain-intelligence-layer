// CLI: `npm run classify -- <file.json>` or pipe JSON via stdin. Classifies a
// resource against the built-in mock-taxonomy.ts (or a taxonomy embedded in
// the input) with no Notion or AI calls, and prints the result as JSON. See
// classify-notion.ts for the version that reads your real Notion taxonomy.
import { classifyResource } from "../ai/classify-resource.js";
import { mockTaxonomy } from "../retrieval/mock-taxonomy.js";
import { readJsonArgumentOrStdin } from "./read-json.js";
import type { Taxonomy } from "../../../shared/types/taxonomy.js";
import type { TrustedResourceInput } from "../../../shared/types/resource.js";

type CliInput = {
  resource: TrustedResourceInput;
  taxonomy?: Taxonomy;
};

const input = (await readJsonArgumentOrStdin()) as CliInput;
const output = classifyResource({
  resource: input.resource,
  taxonomy: input.taxonomy ?? mockTaxonomy
});

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);


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

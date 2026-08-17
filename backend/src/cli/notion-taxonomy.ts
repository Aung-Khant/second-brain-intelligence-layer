import { loadDotEnv } from "../config/env.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";

loadDotEnv();

const taxonomy = await fetchNotionTaxonomy();
process.stdout.write(`${JSON.stringify(taxonomy, null, 2)}\n`);


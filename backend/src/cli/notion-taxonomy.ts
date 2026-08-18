// CLI: `npm run taxonomy:notion`. Fetches your live Notion Areas/Topics/
// Projects and prints them as JSON - useful for sanity-checking that
// NOTION_API_KEY and the data source IDs in .env are wired up correctly.
import { loadDotEnv } from "../config/env.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";

loadDotEnv();

const taxonomy = await fetchNotionTaxonomy();
process.stdout.write(`${JSON.stringify(taxonomy, null, 2)}\n`);


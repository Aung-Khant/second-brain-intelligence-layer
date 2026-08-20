// CLI: `npm run taxonomy:notion`. Fetches your live Notion Areas/Topics/
// Projects and prints them as JSON - useful for sanity-checking that
// NOTION_API_KEY and the data source IDs in .env are wired up correctly.
import { loadDotEnv } from "../config/env.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";
import { readNotionTaxonomyConfig } from "../notion/config.js";

loadDotEnv();

const taxonomy = await fetchNotionTaxonomy(readNotionTaxonomyConfig());
process.stdout.write(`${JSON.stringify(taxonomy, null, 2)}\n`);


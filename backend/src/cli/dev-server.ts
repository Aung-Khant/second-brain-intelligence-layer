// CLI: `npm run server`. Loads .env and starts the local HTTP API that the
// Chrome extension talks to (see server/dev-server.ts and server/api.ts for
// the actual routes and request handling).
import { loadDotEnv } from "../config/env.js";
import { startDevServer } from "../server/dev-server.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";

loadDotEnv();
startDevServer();

// Warm the taxonomy cache now rather than making the first Analyze of the
// session wait on Notion. Failures are ignored on purpose: this is only an
// optimization, and the real request will surface any error properly.
void fetchNotionTaxonomy().catch(() => undefined);

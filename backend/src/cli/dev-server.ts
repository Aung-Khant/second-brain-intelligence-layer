// CLI: `npm run server`. Loads .env and starts the local HTTP API that the
// Chrome extension talks to (see server/dev-server.ts and server/api.ts for
// the actual routes and request handling).
import { loadDotEnv } from "../config/env.js";
import { startDevServer } from "../server/dev-server.js";
import { fetchNotionTaxonomy } from "../notion/taxonomy.js";
import { localEnvFallbackEnabled, readNotionTaxonomyConfig } from "../notion/config.js";

loadDotEnv();
startDevServer();

// Warm the cache for the single-user env fallback only. Connected workspaces
// warm on their owner's first request instead - there is no "the" workspace to
// prefetch any more, and eagerly reading every stored connection at boot would
// hit Notion on behalf of people who are not using the server right now.
if (localEnvFallbackEnabled()) {
  void fetchNotionTaxonomy(readNotionTaxonomyConfig()).catch(() => undefined);
}

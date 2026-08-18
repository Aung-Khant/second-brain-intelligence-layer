// CLI: `npm run server`. Loads .env and starts the local HTTP API that the
// Chrome extension talks to (see server/dev-server.ts and server/api.ts for
// the actual routes and request handling).
import { loadDotEnv } from "../config/env.js";
import { startDevServer } from "../server/dev-server.js";

loadDotEnv();
startDevServer();

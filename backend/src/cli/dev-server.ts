import { loadDotEnv } from "../config/env.js";
import { startDevServer } from "../server/dev-server.js";

loadDotEnv();
startDevServer();

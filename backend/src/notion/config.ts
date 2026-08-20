// Where a Notion request gets its credentials and its four data source ids.
//
// There are two sources, and the difference is the whole point of multi-user:
//
//   configForConnection()  the normal path. Token and ids come from the
//                          connection the caller's session resolved to, so two
//                          people using the same server touch entirely
//                          different workspaces.
//
//   readNotionTaxonomyConfig()  a single-user fallback for local development,
//                          reading NOTION_API_KEY and the NOTION_*_DATA_SOURCE_ID
//                          vars. It is the pre-OAuth setup, kept working on
//                          purpose so an existing .env keeps running, but it
//                          is nobody's production path - it can only ever
//                          describe one workspace.
import { AppError } from "../../../shared/types/errors.js";
import { accessTokenFor, type NotionConnection } from "../auth/connections.js";

export type NotionTaxonomyConfig = {
  apiKey: string;
  notionVersion: string;
  areasDataSourceId: string;
  topicsDataSourceId: string;
  projectsDataSourceId: string;
  resourcesDataSourceId: string;
  // Identifies whose workspace this is, so caches and correction records can
  // be kept apart. "local" for the env fallback.
  connectionId: string;
};

export function notionVersion(): string {
  return process.env.NOTION_VERSION || "2026-03-11";
}

export async function configForConnection(
  connection: NotionConnection
): Promise<NotionTaxonomyConfig> {
  if (!connection.roles) {
    throw new AppError(
      "NOTION_AUTH_FAILED",
      "Finish choosing your Areas, Projects, Topics, and Resources databases."
    );
  }

  return {
    apiKey: await accessTokenFor(connection.id),
    notionVersion: notionVersion(),
    connectionId: connection.id,
    ...connection.roles
  };
}

export function hasLocalEnvConfig(): boolean {
  return Boolean(process.env.NOTION_API_KEY?.trim());
}

// The env fallback must now be opted into explicitly. Before this gate, any
// request that arrived without a session was silently served the OWNER's
// workspace whenever the server had NOTION_API_KEY set - which meant a friend
// who installed the extension and never connected saved straight into the
// owner's Notion. Off by default so a shared server always sends new people
// through onboarding; the owner sets ALLOW_LOCAL_ENV_FALLBACK=true in .env to
// keep the sessionless local-dev path working on their own machine.
export function localEnvFallbackEnabled(): boolean {
  return (
    hasLocalEnvConfig() &&
    process.env.ALLOW_LOCAL_ENV_FALLBACK?.trim().toLowerCase() === "true"
  );
}

export function readNotionTaxonomyConfig(): NotionTaxonomyConfig {
  return {
    apiKey: requireEnv("NOTION_API_KEY"),
    notionVersion: notionVersion(),
    connectionId: "local",
    areasDataSourceId: requireEnv("NOTION_AREAS_DATA_SOURCE_ID"),
    topicsDataSourceId: requireEnv("NOTION_TOPICS_DATA_SOURCE_ID"),
    projectsDataSourceId: requireEnv("NOTION_PROJECTS_DATA_SOURCE_ID"),
    resourcesDataSourceId: requireEnv("NOTION_RESOURCES_DATA_SOURCE_ID")
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError("NOTION_AUTH_FAILED", `Missing required environment variable: ${name}`);
  }
  return value;
}

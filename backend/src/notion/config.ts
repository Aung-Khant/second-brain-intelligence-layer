// Reads NOTION_API_KEY and the four data source IDs from env, falling back
// to this repo's own default data source IDs when the corresponding env var
// isn't set. Note the env var names are NOTION_*_DATA_SOURCE_ID - a
// differently-named var (e.g. NOTION_*_DATABASE_ID) is silently ignored and
// the default ID is used instead, since only these exact names are read.
import { AppError } from "../../../shared/types/errors.js";

export type NotionTaxonomyConfig = {
  apiKey: string;
  notionVersion: string;
  areasDataSourceId: string;
  topicsDataSourceId: string;
  projectsDataSourceId: string;
  resourcesDataSourceId: string;
};

const defaultDataSourceIds = {
  areas: "048d5cf2-323d-8307-a7e6-8795bc75196a",
  topics: "4c1d5cf2-323d-820e-bed5-87a0b774f147",
  projects: "3e1d5cf2-323d-8299-9af5-8703a17b96c7",
  resources: "ab7d5cf2-323d-8350-abec-07da57d306af"
} as const;

export function readNotionTaxonomyConfig(): NotionTaxonomyConfig {
  return {
    apiKey: requireEnv("NOTION_API_KEY"),
    notionVersion: process.env.NOTION_VERSION || "2026-03-11",
    areasDataSourceId: process.env.NOTION_AREAS_DATA_SOURCE_ID || defaultDataSourceIds.areas,
    topicsDataSourceId: process.env.NOTION_TOPICS_DATA_SOURCE_ID || defaultDataSourceIds.topics,
    projectsDataSourceId: process.env.NOTION_PROJECTS_DATA_SOURCE_ID || defaultDataSourceIds.projects,
    resourcesDataSourceId: process.env.NOTION_RESOURCES_DATA_SOURCE_ID || defaultDataSourceIds.resources
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError("NOTION_AUTH_FAILED", `Missing required environment variable: ${name}`);
  }
  return value;
}

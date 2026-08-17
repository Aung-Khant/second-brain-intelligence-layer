import { AppError } from "../../../shared/types/errors.js";

export type NotionTaxonomyConfig = {
  apiKey: string;
  notionVersion: string;
  areasDataSourceId: string;
  topicsDataSourceId: string;
  projectsDataSourceId: string;
};

const defaultDataSourceIds = {
  areas: "048d5cf2-323d-8307-a7e6-8795bc75196a",
  topics: "4c1d5cf2-323d-820e-bed5-87a0b774f147",
  projects: "3e1d5cf2-323d-8299-9af5-8703a17b96c7"
} as const;

export function readNotionTaxonomyConfig(): NotionTaxonomyConfig {
  return {
    apiKey: requireEnv("NOTION_API_KEY"),
    notionVersion: process.env.NOTION_VERSION || "2026-03-11",
    areasDataSourceId: process.env.NOTION_AREAS_DATA_SOURCE_ID || defaultDataSourceIds.areas,
    topicsDataSourceId: process.env.NOTION_TOPICS_DATA_SOURCE_ID || defaultDataSourceIds.topics,
    projectsDataSourceId: process.env.NOTION_PROJECTS_DATA_SOURCE_ID || defaultDataSourceIds.projects
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError("NOTION_AUTH_FAILED", `Missing required environment variable: ${name}`);
  }
  return value;
}

import type { Area, Project, ProjectStatus, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import { assertTaxonomy } from "../../../shared/schemas/validation.js";
import { NotionClient, getCheckbox, getRelationIds, getRichText, getStatus, getTitle } from "./client.js";
import { readNotionTaxonomyConfig } from "./config.js";

export async function fetchNotionTaxonomy(): Promise<Taxonomy> {
  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);

  const [areaPages, topicPages, projectPages] = await Promise.all([
    client.queryDataSource(config.areasDataSourceId),
    client.queryDataSource(config.topicsDataSourceId),
    client.queryDataSource(config.projectsDataSourceId)
  ]);

  const areasById = new Map<string, string>();
  for (const page of areaPages) {
    const name = getTitle(page.properties);
    if (name) areasById.set(page.id, name);
  }

  const topicsById = new Map<string, string>();
  for (const page of topicPages) {
    const name = getTitle(page.properties);
    if (name) topicsById.set(page.id, name);
  }

  const taxonomy: Taxonomy = {
    areas: areaPages.map((page) => toArea(page.id, page.properties)).filter(isPresent),
    topics: topicPages.map((page) => toTopic(page.id, page.properties, areasById)).filter(isPresent),
    projects: projectPages
      .map((page) => toProject(page.id, page.properties, areasById, topicsById))
      .filter(isPresent)
  };

  assertTaxonomy(taxonomy);
  return taxonomy;
}

function toArea(id: string, properties: Record<string, unknown>): Area | undefined {
  const name = getTitle(properties);
  if (!name || getCheckbox(properties, "Archive")) return undefined;

  return {
    id,
    name,
    definition: [name, getRichText(properties, "Definition"), getRichText(properties, "Description")]
      .filter(Boolean)
      .join(" ")
  };
}

function toTopic(
  id: string,
  properties: Record<string, unknown>,
  areasById: Map<string, string>
): Topic | undefined {
  const name = getTitle(properties);
  if (!name) return undefined;

  return {
    id,
    name,
    definition: [name, getRichText(properties, "Definition"), getRichText(properties, "Description")]
      .filter(Boolean)
      .join(" "),
    areas: getRelationIds(properties, "Areas").map((areaId) => areasById.get(areaId)).filter(isPresent)
  };
}

function toProject(
  id: string,
  properties: Record<string, unknown>,
  areasById: Map<string, string>,
  topicsById: Map<string, string>
): Project | undefined {
  const name = getTitle(properties);
  if (!name) return undefined;

  const status = normalizeProjectStatus(getStatus(properties, "Status"), getCheckbox(properties, "Archive"));

  return {
    id,
    name,
    goal: [
      name,
      getRichText(properties, "Goal"),
      getRichText(properties, "Problem"),
      getRichText(properties, "Description")
    ]
      .filter(Boolean)
      .join(" "),
    areas: getRelationIds(properties, "Areas").map((areaId) => areasById.get(areaId)).filter(isPresent),
    topics: getRelationIds(properties, "Topics").map((topicId) => topicsById.get(topicId)).filter(isPresent),
    status
  };
}

function normalizeProjectStatus(status: string | undefined, archived: boolean): ProjectStatus {
  if (archived || status === "Done") return "archived";
  return "active";
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}


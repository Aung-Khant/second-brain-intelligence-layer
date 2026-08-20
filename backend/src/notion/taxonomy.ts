// Fetches and shapes the Areas/Topics/Projects taxonomy from Notion, with an
// in-memory cache (default 10 minutes, override with
// NOTION_TAXONOMY_CACHE_TTL_MS, 0 disables it) and in-flight de-duplication
// so concurrent classify/enhance calls don't trigger duplicate Notion
// queries. clearNotionTaxonomyCache() is called after creating a new Area or
// Topic so it shows up immediately instead of waiting for the TTL.
import type { Area, Project, ProjectStatus, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import { assertTaxonomy } from "../../../shared/schemas/validation.js";
import { NotionClient, getCheckbox, getRelationIds, getRichText, getStatus, getTitle } from "./client.js";
import type { NotionTaxonomyConfig } from "./config.js";

const defaultTaxonomyCacheTtlMs = 10 * 60 * 1000;

// Keyed by connection id. A single shared cache was fine when the server knew
// one workspace; with several connected it would serve one person's Areas to
// another, which is a correctness and a privacy bug at once.
const cachedTaxonomies = new Map<string, { expiresAt: number; taxonomy: Taxonomy }>();
const pendingTaxonomyFetches = new Map<string, Promise<Taxonomy>>();

export async function fetchNotionTaxonomy(config: NotionTaxonomyConfig): Promise<Taxonomy> {
  const key = config.connectionId;
  const cached = cachedTaxonomies.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.taxonomy;
  }

  const inFlight = pendingTaxonomyFetches.get(key);
  if (inFlight) return inFlight;

  const fetchPromise = fetchFreshNotionTaxonomy(config)
    .then((taxonomy) => {
      cachedTaxonomies.set(key, {
        taxonomy,
        expiresAt: Date.now() + readTaxonomyCacheTtlMs()
      });
      return taxonomy;
    })
    .finally(() => {
      pendingTaxonomyFetches.delete(key);
    });

  pendingTaxonomyFetches.set(key, fetchPromise);
  return fetchPromise;
}

export function clearNotionTaxonomyCache(connectionId?: string): void {
  if (!connectionId) {
    cachedTaxonomies.clear();
    pendingTaxonomyFetches.clear();
    return;
  }

  cachedTaxonomies.delete(connectionId);
  pendingTaxonomyFetches.delete(connectionId);
}

export function readNotionTaxonomyCacheStatus(): {
  cachedConnections: number;
  ttlMs: number;
} {
  const now = Date.now();
  let live = 0;
  for (const entry of cachedTaxonomies.values()) {
    if (entry.expiresAt > now) live += 1;
  }

  return { cachedConnections: live, ttlMs: readTaxonomyCacheTtlMs() };
}

async function fetchFreshNotionTaxonomy(config: NotionTaxonomyConfig): Promise<Taxonomy> {
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

function readTaxonomyCacheTtlMs(): number {
  const rawValue = process.env.NOTION_TAXONOMY_CACHE_TTL_MS;
  if (!rawValue) return defaultTaxonomyCacheTtlMs;

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultTaxonomyCacheTtlMs;
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
      getRichText(properties, "Definition"),
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

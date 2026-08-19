// Creates a new Area, Project, or Topic in Notion, on explicit human request.
//
// This is the one place the MVP adds to the taxonomy, and the distinction that
// makes it safe is *who asked*: the AI can only ever select from what already
// exists (see classify.ts, which drops any ID not in the taxonomy). A page is
// created here only because a person typed a name and confirmed it.
//
// Only the title property is set, and the database's default template supplies
// the page structure. Leaving every other property to Notion keeps this working
// regardless of what columns a given workspace's databases have, and avoids the
// class of 400 that comes from naming a property the database doesn't define.
import { AppError } from "../../../shared/types/errors.js";
import type { EntityType } from "../../../shared/types/captured-resource.js";
import { NotionClient } from "../notion/client.js";
import { readNotionTaxonomyConfig } from "../notion/config.js";
import { clearNotionTaxonomyCache, fetchNotionTaxonomy } from "../notion/taxonomy.js";

export type CreateEntityInput = {
  entityType: EntityType;
  name: string;
};

export type CreatedEntity = {
  entityType: EntityType;
  id: string;
  name: string;
  url: string;
  created: boolean;
};

const labels: Record<EntityType, string> = {
  area: "Area",
  project: "Project",
  topic: "Topic"
};

export async function createTaxonomyEntity(input: CreateEntityInput): Promise<CreatedEntity> {
  const entityType = input?.entityType;
  if (entityType !== "area" && entityType !== "project" && entityType !== "topic") {
    throw new AppError("UNSUPPORTED_RESOURCE", "Unknown entity type.");
  }

  const name = normalizeName(input.name, entityType);

  // Reuse an existing entity when the name already matches. Two Areas called
  // "Computer Science" is a worse outcome than a no-op, and the user can't see
  // the whole taxonomy from the popup to know it was already there.
  const existing = await findExisting(entityType, name);
  if (existing) {
    return { entityType, ...existing, created: false };
  }

  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);

  try {
    const page = await client.createPageInDataSource(
      dataSourceIdFor(entityType, config),
      { Name: { title: [{ text: { content: name } }] } },
      { useDefaultTemplate: true }
    );

    // Drop the cache so the new entity is selectable immediately rather than
    // after the TTL expires.
    clearNotionTaxonomyCache();

    return { entityType, id: page.id, name, url: page.url, created: true };
  } catch (error) {
    throw new AppError(
      "NOTION_SAVE_FAILED",
      `Failed to create ${labels[entityType]} in Notion.`,
      error
    );
  }
}

async function findExisting(
  entityType: EntityType,
  name: string
): Promise<{ id: string; name: string; url: string } | undefined> {
  const taxonomy = await fetchNotionTaxonomy();
  const pool =
    entityType === "area"
      ? taxonomy.areas
      : entityType === "project"
        ? taxonomy.projects
        : taxonomy.topics;

  const match = pool.find((entity) => entity.name.toLowerCase() === name.toLowerCase());
  return match ? { id: match.id, name: match.name, url: "" } : undefined;
}

function dataSourceIdFor(
  entityType: EntityType,
  config: ReturnType<typeof readNotionTaxonomyConfig>
): string {
  if (entityType === "area") return config.areasDataSourceId;
  if (entityType === "project") return config.projectsDataSourceId;
  return config.topicsDataSourceId;
}

function normalizeName(value: unknown, entityType: EntityType): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) {
    throw new AppError("PAGE_EXTRACTION_FAILED", `${labels[entityType]} name is required.`);
  }

  return name.slice(0, 80);
}

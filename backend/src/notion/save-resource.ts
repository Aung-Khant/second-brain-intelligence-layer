// Creates the actual Resource page in Notion once the user hits Save.
// Checks for a duplicate by normalized URL first (see url.ts) and returns
// "duplicate" instead of creating a second page for the same link. Property
// names here (Name, URL, Type, Status, "Save Intent", Areas, Topics,
// Projects, Description, "Why Saved", Archive, Favorite) must exactly match
// the Notion database's actual property names - there's no schema
// validation on the Notion side, so a typo here silently writes to a
// property that doesn't exist and the field just looks empty in Notion.
import { AppError } from "../../../shared/types/errors.js";
import type { ResourceType, SaveIntent } from "../../../shared/types/resource.js";
import type { ConfirmedResource, SaveResourceResult } from "../../../shared/types/save.js";
import { assertConfirmedResource } from "../../../shared/schemas/save-validation.js";
import { NotionClient, getTitle, getUrl } from "./client.js";
import { readNotionTaxonomyConfig } from "./config.js";
import { normalizeResourceUrl, urlsMatch } from "./url.js";

const notionResourceTypeByResourceType: Record<ResourceType, string> = {
  webpage: "Article",
  article: "Article",
  youtube_video: "Video",
  youtube_channel: "Video"
};

const notionSaveIntentBySaveIntent: Record<SaveIntent, string> = {
  learn: "Learn",
  use_for_project: "Use for Project",
  research: "Research",
  reference: "Reference",
  content_inspiration: "Content Inspiration",
  explore_later: "Explore Later",
  other: "Other"
};

export async function saveResourceToNotion(
  input: ConfirmedResource
): Promise<SaveResourceResult> {
  assertConfirmedResource(input);

  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);
  const normalizedUrl = normalizeResourceUrl(input.url);
  const duplicate = await findDuplicateResource(client, config.resourcesDataSourceId, normalizedUrl);

  if (duplicate) {
    return {
      status: "duplicate",
      resourceId: duplicate.id,
      resourceUrl: duplicate.url
    };
  }

  try {
    const page = await client.createPageInDataSource(
      config.resourcesDataSourceId,
      buildResourceProperties(input, normalizedUrl),
      { useDefaultTemplate: true }
    );

    return {
      status: "saved",
      resourceId: page.id,
      resourceUrl: page.url
    };
  } catch (error) {
    throw new AppError("NOTION_SAVE_FAILED", "Failed to save Resource into Notion.", error);
  }
}

export async function findDuplicateResource(
  client: NotionClient,
  resourcesDataSourceId: string,
  normalizedUrl: string
): Promise<{ id: string; url: string } | undefined> {
  const exactMatches = await client.queryDataSourceWithFilter(resourcesDataSourceId, {
    property: "URL",
    url: {
      equals: normalizedUrl
    }
  });

  const exact = exactMatches.find((page) =>
    urlsMatch(getUrl(page.properties, "URL") ?? "", normalizedUrl)
  );

  if (exact) {
    return { id: exact.id, url: exact.url };
  }

  const allResources = await client.queryDataSource(resourcesDataSourceId);
  const normalized = allResources.find((page) =>
    urlsMatch(getUrl(page.properties, "URL") ?? "", normalizedUrl)
  );

  return normalized ? { id: normalized.id, url: normalized.url } : undefined;
}

export async function checkDuplicateResourceInNotion(
  url: string
): Promise<{ id: string; url: string } | undefined> {
  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);
  return findDuplicateResource(client, config.resourcesDataSourceId, normalizeResourceUrl(url));
}

function buildResourceProperties(
  input: ConfirmedResource,
  normalizedUrl: string
): Record<string, unknown> {
  const description = input.summary || input.description;
  const properties: Record<string, unknown> = {
    Name: {
      title: [{ text: { content: input.name } }]
    },
    URL: {
      url: normalizedUrl
    },
    Type: {
      select: { name: notionResourceTypeByResourceType[input.resourceType] }
    },
    Status: {
      status: { name: "To Review" }
    },
    "Save Intent": {
      select: { name: notionSaveIntentBySaveIntent[input.saveIntent] }
    },
    Areas: {
      relation: input.areaIds.map((id) => ({ id }))
    },
    Topics: {
      relation: input.topicIds.map((id) => ({ id }))
    },
    Projects: {
      relation: input.projectIds.map((id) => ({ id }))
    },
    Archive: {
      checkbox: false
    },
    Favorite: {
      checkbox: false
    }
  };

  if (description) {
    properties.Description = {
      rich_text: [{ text: { content: description } }]
    };
  }

  if (input.whySaved) {
    properties["Why Saved"] = {
      rich_text: [{ text: { content: input.whySaved } }]
    };
  }

  return properties;
}

export function summarizeSavedResourceName(properties: Record<string, unknown>): string {
  return getTitle(properties);
}

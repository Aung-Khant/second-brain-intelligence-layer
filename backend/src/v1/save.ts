// Step 7. Writes the confirmed Resource into Notion using the existing Notion
// client, config, and duplicate detection - only the property mapping is new.
//
// The MVP maps Name, URL, Type, Why Saved, Areas, Projects, Topics. Status,
// Archive, and Favorite are also written because every existing row in the
// database has them; leaving them empty would make new rows look broken next
// to old ones. Save Intent is intentionally not written - it is not part of
// this slice.
//
// Property names must match the Notion database exactly. Notion does not
// validate them, so a typo silently writes to nothing and the field just looks
// empty. See the same warning in notion/save-resource.ts.
import { AppError } from "../../../shared/types/errors.js";
import { NotionClient } from "../notion/client.js";
import { readNotionTaxonomyConfig } from "../notion/config.js";
import { findDuplicateResource } from "../notion/save-resource.js";
import { normalizeResourceUrl } from "../notion/url.js";

export type VideoResourceToSave = {
  name: string;
  url: string;
  whySaved?: string;
  areaIds: string[];
  projectIds: string[];
  topicIds: string[];
};

export type SavedResource = {
  status: "saved" | "duplicate";
  resourceId: string;
  resourceUrl: string;
};

export async function saveVideoResource(input: VideoResourceToSave): Promise<SavedResource> {
  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);
  const normalizedUrl = normalizeResourceUrl(input.url);

  const duplicate = await findDuplicateResource(
    client,
    config.resourcesDataSourceId,
    normalizedUrl
  );

  if (duplicate) {
    return { status: "duplicate", resourceId: duplicate.id, resourceUrl: duplicate.url };
  }

  try {
    const page = await client.createPageInDataSource(
      config.resourcesDataSourceId,
      buildProperties(input, normalizedUrl),
      { useDefaultTemplate: true }
    );

    return { status: "saved", resourceId: page.id, resourceUrl: page.url };
  } catch (error) {
    throw new AppError("NOTION_SAVE_FAILED", "Failed to save the Resource into Notion.", error);
  }
}

function buildProperties(
  input: VideoResourceToSave,
  normalizedUrl: string
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: input.name } }] },
    URL: { url: normalizedUrl },
    Type: { select: { name: "Video" } },
    Status: { status: { name: "To Review" } },
    Areas: { relation: input.areaIds.map((id) => ({ id })) },
    Projects: { relation: input.projectIds.map((id) => ({ id })) },
    Topics: { relation: input.topicIds.map((id) => ({ id })) },
    Archive: { checkbox: false },
    Favorite: { checkbox: false }
  };

  if (input.whySaved?.trim()) {
    properties["Why Saved"] = {
      rich_text: [{ text: { content: input.whySaved.trim() } }]
    };
  }

  return properties;
}

// Step 7. Writes the confirmed Resource into Notion using the existing Notion
// client, config, and duplicate detection - only the property mapping is new.
//
// Maps Name, URL, Type, Description, Why Saved, Areas, Projects, Topics - the
// full set of properties this database has. Do not add Status, Archive,
// Favorite, or Save Intent here even if another workspace's schema has them:
// a property this code sends that the Resources database doesn't define is a
// hard 400 from Notion, not a silent no-op. Check the live schema before
// adding any property here.
//
// Property names must match the Notion database exactly. Notion does not
// validate them, so a typo silently writes to nothing and the field just looks
// empty. See the same warning in notion/save-resource.ts.
import { AppError } from "../../../shared/types/errors.js";
import type { SourceType } from "../../../shared/types/captured-resource.js";
import { NotionClient } from "../notion/client.js";
import { readNotionTaxonomyConfig } from "../notion/config.js";
import { findDuplicateResource } from "../notion/save-resource.js";
import { normalizeResourceUrl } from "../notion/url.js";

export type VideoResourceToSave = {
  name: string;
  url: string;
  sourceType: SourceType;
  whySaved?: string;
  summary?: string;
  areaIds: string[];
  projectIds: string[];
  topicIds: string[];
};

// Maps to the options that already exist in the Type select. A value not in
// this list would be rejected by Notion.
const notionTypeBySourceType: Record<SourceType, string> = {
  youtube_video: "Video",
  youtube_channel: "YouTube Channel"
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
    // No useDefaultTemplate: this endpoint sets every needed property itself,
    // and requesting a default template 400s on any Resources database that
    // doesn't have one configured.
    // Use the database's default template so a saved Resource gets the same
    // page structure as one created by hand in Notion. Falls back to a plain
    // page automatically if no template is configured.
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
    Type: { select: { name: notionTypeBySourceType[input.sourceType] } },
    Areas: { relation: input.areaIds.map((id) => ({ id })) },
    Projects: { relation: input.projectIds.map((id) => ({ id })) },
    Topics: { relation: input.topicIds.map((id) => ({ id })) }
  };

  if (input.whySaved?.trim()) {
    properties["Why Saved"] = {
      rich_text: [{ text: { content: input.whySaved.trim() } }]
    };
  }

  // The AI summary. A single rich_text value caps at 2000 characters, and the
  // summary is far shorter than that, but the slice keeps a long one from
  // failing the whole save.
  if (input.summary?.trim()) {
    properties.Description = {
      rich_text: [{ text: { content: input.summary.trim().slice(0, 1900) } }]
    };
  }

  return properties;
}

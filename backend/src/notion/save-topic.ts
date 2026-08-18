// Creates a new Topic page in Notion (used when the user accepts a
// suggested-new-Topic in the extension) using the database's default
// template, and clears the taxonomy cache so the new Topic is immediately
// selectable. Mirrors save-area.ts.
import { AppError } from "../../../shared/types/errors.js";
import type { CreatedTopic } from "../../../shared/types/resource.js";
import { NotionClient } from "./client.js";
import { readNotionTaxonomyConfig } from "./config.js";
import { clearNotionTaxonomyCache } from "./taxonomy.js";

export type CreateTopicInput = {
  name: string;
  areaId?: string;
  areaName?: string;
};

export async function createTopicInNotion(input: CreateTopicInput): Promise<CreatedTopic> {
  const name = normalizeName(input.name);
  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);

  try {
    const page = await client.createPageInDataSource(
      config.topicsDataSourceId,
      buildTopicProperties({
        ...input,
        name
      }),
      { useDefaultTemplate: true }
    );

    clearNotionTaxonomyCache();

    return {
      id: page.id,
      name,
      url: page.url,
      areaId: input.areaId,
      areaName: input.areaName
    };
  } catch (error) {
    throw new AppError("NOTION_SAVE_FAILED", "Failed to create Topic in Notion.", error);
  }
}

function buildTopicProperties(input: CreateTopicInput): Record<string, unknown> {
  return {
    Name: {
      title: [{ text: { content: normalizeName(input.name) } }]
    }
  };
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw new AppError("AI_INVALID_OUTPUT", "Topic name is required.");
  }

  return name.slice(0, 80);
}

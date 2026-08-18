// Creates a new Area page in Notion (used when the user accepts a suggested-
// new-Area in the extension) and clears the in-memory taxonomy cache
// afterward so the next classify/enhance call sees the new Area immediately
// instead of waiting out the cache TTL.
import { AppError } from "../../../shared/types/errors.js";
import type { CreatedArea } from "../../../shared/types/resource.js";
import { NotionClient } from "./client.js";
import { readNotionTaxonomyConfig } from "./config.js";
import { clearNotionTaxonomyCache } from "./taxonomy.js";

export type CreateAreaInput = {
  name: string;
};

export async function createAreaInNotion(input: CreateAreaInput): Promise<CreatedArea> {
  const name = normalizeName(input.name);
  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);

  try {
    const page = await client.createPageInDataSource(
      config.areasDataSourceId,
      buildAreaProperties(name),
      { useDefaultTemplate: true }
    );

    clearNotionTaxonomyCache();

    return {
      id: page.id,
      name,
      url: page.url
    };
  } catch (error) {
    throw new AppError("NOTION_SAVE_FAILED", "Failed to create Area in Notion.", error);
  }
}

function buildAreaProperties(name: string): Record<string, unknown> {
  return {
    Name: {
      title: [{ text: { content: name } }]
    }
  };
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw new AppError("AI_INVALID_OUTPUT", "Area name is required.");
  }

  return name.slice(0, 80);
}

// Creates a new Project page in Notion (used when the user picks "+ New
// Project..." from the manual Project picker in the extension) using the
// database's default template, and clears the taxonomy cache so the new
// Project is immediately selectable. Mirrors save-area.ts/save-topic.ts.
//
// Unlike Areas/Topics, Projects were originally never user-creatable here -
// the AI prompt still tells the model "Projects must be existing active
// work only. Do not invent new Projects," and that stays true for AI
// suggestions. This is specifically the manual "I know this Project should
// exist, add it" escape hatch requested for the extension's picker.
import { AppError } from "../../../shared/types/errors.js";
import type { CreatedProject } from "../../../shared/types/resource.js";
import { NotionClient } from "./client.js";
import { readNotionTaxonomyConfig } from "./config.js";
import { clearNotionTaxonomyCache } from "./taxonomy.js";

export type CreateProjectInput = {
  name: string;
};

export async function createProjectInNotion(input: CreateProjectInput): Promise<CreatedProject> {
  const name = normalizeName(input.name);
  const config = readNotionTaxonomyConfig();
  const client = new NotionClient(config);

  try {
    const page = await client.createPageInDataSource(
      config.projectsDataSourceId,
      buildProjectProperties(name),
      { useDefaultTemplate: true }
    );

    clearNotionTaxonomyCache();

    return {
      id: page.id,
      name,
      url: page.url
    };
  } catch (error) {
    throw new AppError("NOTION_SAVE_FAILED", "Failed to create Project in Notion.", error);
  }
}

function buildProjectProperties(name: string): Record<string, unknown> {
  return {
    Name: {
      title: [{ text: { content: name } }]
    }
  };
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw new AppError("AI_INVALID_OUTPUT", "Project name is required.");
  }

  return name.slice(0, 80);
}

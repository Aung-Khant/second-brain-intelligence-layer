// Finding the four databases inside whichever workspace just connected.
//
// This is what the hardcoded data source ids in notion/config.ts used to do,
// and why the product only ever worked for one person: those ids named one
// specific workspace. Every workspace lays its Second Brain out differently,
// so the ids have to be discovered per connection and confirmed by the person
// who owns them.
//
// Matching by name is a guess, so it is only ever a *suggestion*. The
// onboarding page shows what was guessed and lets the user correct it before
// anything is written.
import type { DataSourceRoles } from "./connections.js";

export type DiscoveredDataSource = {
  id: string;
  title: string;
};

export type DiscoverySuggestion = {
  available: DiscoveredDataSource[];
  suggested: Partial<DataSourceRoles>;
  // True when every role was matched confidently enough to skip the picker.
  complete: boolean;
};

// Ordered by how strongly each name implies the role. "Resources" is checked
// before the singular so a database literally called "Resources" wins over one
// called "Resource Notes".
const roleAliases: Record<keyof DataSourceRoles, string[]> = {
  areasDataSourceId: ["areas", "area", "life areas", "domains"],
  projectsDataSourceId: ["projects", "project"],
  topicsDataSourceId: ["topics", "topic", "tags"],
  resourcesDataSourceId: ["resources", "resource", "sources", "library", "inbox"]
};

export async function discoverDataSources(
  accessToken: string,
  notionVersion: string
): Promise<DiscoverySuggestion> {
  const available = await searchDataSources(accessToken, notionVersion);
  const suggested: Partial<DataSourceRoles> = {};
  const taken = new Set<string>();

  for (const [role, aliases] of Object.entries(roleAliases) as [
    keyof DataSourceRoles,
    string[]
  ][]) {
    const match = available.find(
      (source) => !taken.has(source.id) && aliases.includes(source.title.trim().toLowerCase())
    );

    if (match) {
      suggested[role] = match.id;
      taken.add(match.id);
    }
  }

  return {
    available,
    suggested,
    complete: Object.keys(roleAliases).every((role) => Boolean(suggested[role as keyof DataSourceRoles]))
  };
}

async function searchDataSources(
  accessToken: string,
  notionVersion: string
): Promise<DiscoveredDataSource[]> {
  const found: DiscoveredDataSource[] = [];
  let cursor: string | undefined;

  do {
    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Notion-Version": notionVersion
      },
      body: JSON.stringify({
        filter: { property: "object", value: "data_source" },
        page_size: 100,
        start_cursor: cursor
      })
    });

    if (!response.ok) break;

    const body = (await response.json()) as {
      results?: { id: string; title?: { plain_text?: string }[] }[];
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const result of body.results ?? []) {
      const title = (result.title ?? []).map((part) => part.plain_text ?? "").join("").trim();
      found.push({ id: result.id, title: title || "(untitled)" });
    }

    cursor = body.has_more ? (body.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return found.sort((a, b) => a.title.localeCompare(b.title));
}

import { AppError } from "../../../shared/types/errors.js";
import type { NotionTaxonomyConfig } from "./config.js";

export type NotionPage = {
  id: string;
  url: string;
  properties: Record<string, unknown>;
};

type NotionListResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

export class NotionClient {
  constructor(private readonly config: NotionTaxonomyConfig) {}

  async queryDataSource(dataSourceId: string): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let startCursor: string | undefined;

    do {
      const response = await this.request<NotionListResponse>(
        `/v1/data_sources/${dataSourceId}/query`,
        {
          method: "POST",
          body: JSON.stringify({
            page_size: 100,
            start_cursor: startCursor
          })
        }
      );

      pages.push(...response.results);
      startCursor = response.next_cursor ?? undefined;
      if (!response.has_more) break;
    } while (startCursor);

    return pages;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`https://api.notion.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": this.config.notionVersion,
        ...init.headers
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new AppError(
        response.status === 401 || response.status === 403
          ? "NOTION_AUTH_FAILED"
          : "NOTION_FETCH_FAILED",
        `Notion request failed (${response.status}): ${body}`
      );
    }

    return (await response.json()) as T;
  }
}

export function getTitle(properties: Record<string, unknown>, name = "Name"): string {
  const property = properties[name];
  if (!isRecord(property) || property.type !== "title" || !Array.isArray(property.title)) {
    return "";
  }
  return property.title.map((text) => getPlainText(text)).join("").trim();
}

export function getRichText(properties: Record<string, unknown>, name: string): string | undefined {
  const property = properties[name];
  if (!isRecord(property) || property.type !== "rich_text" || !Array.isArray(property.rich_text)) {
    return undefined;
  }
  const value = property.rich_text.map((text) => getPlainText(text)).join("").trim();
  return value || undefined;
}

export function getCheckbox(properties: Record<string, unknown>, name: string): boolean {
  const property = properties[name];
  return isRecord(property) && property.type === "checkbox" && property.checkbox === true;
}

export function getStatus(properties: Record<string, unknown>, name: string): string | undefined {
  const property = properties[name];
  if (!isRecord(property) || property.type !== "status" || !isRecord(property.status)) {
    return undefined;
  }
  return typeof property.status.name === "string" ? property.status.name : undefined;
}

export function getRelationIds(properties: Record<string, unknown>, name: string): string[] {
  const property = properties[name];
  if (!isRecord(property) || property.type !== "relation" || !Array.isArray(property.relation)) {
    return [];
  }
  return property.relation
    .map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : undefined))
    .filter((id): id is string => id !== undefined);
}

function getPlainText(value: unknown): string {
  return isRecord(value) && typeof value.plain_text === "string" ? value.plain_text : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

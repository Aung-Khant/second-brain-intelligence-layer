import { AppError } from "../../../shared/types/errors.js";
import type {
  IntelligentClassification,
  NewTopicSuggestion,
  RelationSuggestion,
  SaveIntent,
  TrustedResourceInput
} from "../../../shared/types/resource.js";
import type { Area, Project, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import { relationshipThresholds } from "../config/classification.js";
import { readOpenAiConfig } from "../config/openai.js";

type OpenAiRelation = {
  entityId: string;
  confidence: number;
  reason: string;
};

type OpenAiClassification = {
  summary: string;
  concepts: string[];
  keywords: string[];
  subjectMatter: string[];
  areas: OpenAiRelation[];
  topics: OpenAiRelation[];
  projects: OpenAiRelation[];
  suggestedTopics: NewTopicSuggestion[];
  suggestedSaveIntent?: SaveIntent;
  suggestedWhySaved?: string;
};

type ResponsesApiOutput = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

const saveIntents: SaveIntent[] = [
  "learn",
  "use_for_project",
  "research",
  "reference",
  "content_inspiration",
  "explore_later",
  "other"
];

export async function classifyResourceWithOpenAi(
  resource: TrustedResourceInput,
  taxonomy: Taxonomy
): Promise<IntelligentClassification> {
  const config = readOpenAiConfig();
  if (!config.apiKey) {
    throw new AppError("AI_REQUEST_FAILED", "OPENAI_API_KEY is required for AI classification.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      input: buildPrompt(resource, taxonomy),
      text: {
        format: {
          type: "json_schema",
          name: "second_brain_classification",
          strict: true,
          schema: responseSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new AppError(
      "AI_REQUEST_FAILED",
      `OpenAI classification failed with HTTP ${response.status}.`
    );
  }

  const payload = (await response.json()) as ResponsesApiOutput;
  return normalizeAiClassification(parseOutputText(payload), taxonomy);
}

function buildPrompt(resource: TrustedResourceInput, taxonomy: Taxonomy): string {
  return [
    "You classify a trusted web resource into a personal Second Brain.",
    "Use only existing Area, Topic, and Project IDs for relation arrays.",
    "Areas are broad and stable. Do not invent new Areas.",
    "Projects must be existing active work only. Do not invent new Projects.",
    "Topics may be existing matches, or suggested as new topics in suggestedTopics when no existing topic fits clearly.",
    "Do not force a misleading existing Topic. Prefer suggestedTopics when the concept is genuinely missing.",
    "For YouTube, ignore generic YouTube platform descriptions and summarize the actual video or channel from title and visible text.",
    "Return concise, useful summary text for the Notion Description field.",
    "",
    `Resource:\n${JSON.stringify(resource, null, 2)}`,
    "",
    `Existing taxonomy:\n${JSON.stringify(toPromptTaxonomy(taxonomy), null, 2)}`
  ].join("\n");
}

function toPromptTaxonomy(taxonomy: Taxonomy): Record<string, unknown> {
  return {
    areas: taxonomy.areas.map((area) => ({
      id: area.id,
      name: area.name,
      definition: area.definition
    })),
    topics: taxonomy.topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      definition: topic.definition,
      areas: topic.areas
    })),
    projects: taxonomy.projects
      .filter((project) => (project.status ?? "active") === "active")
      .map((project) => ({
        id: project.id,
        name: project.name,
        goal: project.goal,
        areas: project.areas,
        topics: project.topics
      }))
  };
}

function parseOutputText(payload: ResponsesApiOutput): OpenAiClassification {
  const text =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((content) => content.text)?.text;

  if (!text) {
    throw new AppError("AI_INVALID_OUTPUT", "OpenAI response did not include output text.");
  }

  return JSON.parse(text) as OpenAiClassification;
}

function normalizeAiClassification(
  output: OpenAiClassification,
  taxonomy: Taxonomy
): IntelligentClassification {
  if (!output || typeof output !== "object") {
    throw new AppError("AI_INVALID_OUTPUT", "AI classification must be an object.");
  }

  return {
    engine: "openai",
    summary: requiredString(output.summary, "summary"),
    concepts: stringArray(output.concepts).slice(0, 12),
    keywords: stringArray(output.keywords).slice(0, 16),
    subjectMatter: stringArray(output.subjectMatter).slice(0, 16),
    areas: normalizeRelations(output.areas, taxonomy.areas),
    topics: normalizeRelations(output.topics, taxonomy.topics),
    projects: normalizeRelations(
      output.projects,
      taxonomy.projects.filter((project) => (project.status ?? "active") === "active")
    ),
    suggestedTopics: normalizeSuggestedTopics(output.suggestedTopics, taxonomy.areas),
    suggestedSaveIntent: saveIntents.includes(output.suggestedSaveIntent as SaveIntent)
      ? output.suggestedSaveIntent
      : undefined,
    suggestedWhySaved:
      typeof output.suggestedWhySaved === "string" && output.suggestedWhySaved.trim()
        ? output.suggestedWhySaved.trim()
        : undefined
  };
}

function normalizeRelations<T extends Area | Topic | Project>(
  relations: OpenAiRelation[] | undefined,
  entities: T[]
): RelationSuggestion[] {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity.name]));
  const seen = new Set<string>();
  const normalized: RelationSuggestion[] = [];

  for (const relation of Array.isArray(relations) ? relations : []) {
    const entityName = entitiesById.get(relation.entityId);
    if (!entityName || seen.has(relation.entityId)) continue;

    seen.add(relation.entityId);
    const confidence = clampConfidence(relation.confidence);
    normalized.push({
      entityId: relation.entityId,
      entityName,
      confidence,
      reason: requiredString(relation.reason, "reason"),
      state:
        confidence >= relationshipThresholds.preselected
          ? "preselected"
          : confidence >= relationshipThresholds.suggested
            ? "suggested"
            : "hidden"
    });
  }

  return normalized
    .filter((relation) => relation.state !== "hidden")
    .sort((a, b) => b.confidence - a.confidence || a.entityName.localeCompare(b.entityName));
}

function normalizeSuggestedTopics(
  suggestions: NewTopicSuggestion[] | undefined,
  areas: Area[]
): NewTopicSuggestion[] {
  const areasById = new Map(areas.map((area) => [area.id, area.name]));
  const seen = new Set<string>();
  const normalized: NewTopicSuggestion[] = [];

  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const name = requiredString(suggestion.name, "suggestedTopics.name").slice(0, 80);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const areaName = suggestion.areaId ? areasById.get(suggestion.areaId) : undefined;
    normalized.push({
      name,
      areaId: areaName ? suggestion.areaId : undefined,
      areaName,
      confidence: clampConfidence(suggestion.confidence),
      reason: requiredString(suggestion.reason, "suggestedTopics.reason")
    });
  }

  return normalized
    .filter((suggestion) => suggestion.confidence >= relationshipThresholds.suggested)
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .slice(0, 3);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("AI_INVALID_OUTPUT", `${field} is required.`);
  }

  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

const relationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    entityId: { type: "string" },
    confidence: { type: "number" },
    reason: { type: "string" }
  },
  required: ["entityId", "confidence", "reason"]
} as const;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    concepts: {
      type: "array",
      items: { type: "string" }
    },
    keywords: {
      type: "array",
      items: { type: "string" }
    },
    subjectMatter: {
      type: "array",
      items: { type: "string" }
    },
    areas: {
      type: "array",
      items: relationSchema
    },
    topics: {
      type: "array",
      items: relationSchema
    },
    projects: {
      type: "array",
      items: relationSchema
    },
    suggestedTopics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          areaId: { type: "string" },
          areaName: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" }
        },
        required: ["name", "areaId", "areaName", "confidence", "reason"]
      }
    },
    suggestedSaveIntent: {
      type: "string",
      enum: saveIntents
    },
    suggestedWhySaved: { type: "string" }
  },
  required: [
    "summary",
    "concepts",
    "keywords",
    "subjectMatter",
    "areas",
    "topics",
    "projects",
    "suggestedTopics",
    "suggestedSaveIntent",
    "suggestedWhySaved"
  ]
} as const;

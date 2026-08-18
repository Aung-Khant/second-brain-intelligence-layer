import { AppError } from "../../../shared/types/errors.js";
import type {
  IntelligentClassification,
  NewAreaSuggestion,
  NewTopicSuggestion,
  RelationSuggestion,
  SaveIntent,
  TrustedResourceInput
} from "../../../shared/types/resource.js";
import type { Area, Project, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import { relationshipThresholds } from "../config/classification.js";
import { readAiConfig, type AiConfig } from "../config/ai.js";

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
  suggestedAreas: NewAreaSuggestion[];
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

type ChatCompletionsOutput = {
  choices?: Array<{
    message?: {
      content?: string;
    };
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
  const config = readAiConfig();
  if (!config.apiKey) {
    throw new AppError(
      "AI_REQUEST_FAILED",
      `${config.provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} is required for AI classification.`
    );
  }

  const output =
    config.provider === "openrouter"
      ? await classifyWithOpenRouter(config, resource, taxonomy)
      : await classifyWithOpenAiResponses(config, resource, taxonomy);

  return normalizeAiClassification(output, taxonomy, config.provider);
}

async function classifyWithOpenAiResponses(
  config: AiConfig,
  resource: TrustedResourceInput,
  taxonomy: Taxonomy
): Promise<OpenAiClassification> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      max_output_tokens: 800,
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
  return parseResponsesOutputText(payload);
}

async function classifyWithOpenRouter(
  config: AiConfig,
  resource: TrustedResourceInput,
  taxonomy: Taxonomy
): Promise<OpenAiClassification> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:3737",
      "X-Title": "Second Brain Intelligence Layer"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: buildPrompt(resource, taxonomy)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "second_brain_classification",
          strict: true,
          schema: responseSchema
        }
      },
      provider: {
        require_parameters: true
      },
      max_tokens: 800,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      "AI_REQUEST_FAILED",
      `OpenRouter classification failed with HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as ChatCompletionsOutput;
  return parseChatCompletionsOutputText(payload);
}

function buildPrompt(resource: TrustedResourceInput, taxonomy: Taxonomy): string {
  return [
    "You classify a trusted web resource into a personal Second Brain.",
    "Use only existing Area, Topic, and Project IDs for relation arrays.",
    "Areas are broad and stable. Do not invent new Areas.",
    "Choose the smallest accurate set of existing Areas, usually 1. Add a second or third Area only when the title, summary, or main content directly supports it.",
    "Do not choose an Area from generic words like product, market, system, brain, learn, or tool unless the resource is actually about that Area.",
    "If no existing Area fits, suggest exactly one broad new Area in suggestedAreas. Do not suggest a new Area when an existing Area is a reasonable fit.",
    "Projects must be existing active work only. Do not invent new Projects.",
    "Topics may be existing matches, or suggested as new topics in suggestedTopics when no existing topic fits clearly.",
    "Existing Topics take priority over new Topic suggestions when the resource directly names or strongly matches an existing Topic.",
    "Only suggest creating a new Topic when no existing Topic is a good fit.",
    "Do not force a misleading existing Topic. Prefer suggestedTopics when the concept is genuinely missing.",
    "Do not mention a Project in suggestedWhySaved unless that exact existing Project ID is included in projects.",
    "For YouTube, ignore generic YouTube platform descriptions and summarize the actual video or channel from title and visible text.",
    "Return concise, useful summary text for the Notion Description field.",
    "Confidence guide: 90-100 for direct title/name matches, 75-89 for strong semantic matches, 60-74 for weaker but useful suggestions.",
    "",
    `Resource:\n${JSON.stringify(toPromptResource(resource), null, 2)}`,
    "",
    `Existing taxonomy:\n${JSON.stringify(toPromptTaxonomy(taxonomy), null, 2)}`
  ].join("\n");
}

function toPromptResource(resource: TrustedResourceInput): TrustedResourceInput {
  return {
    ...resource,
    description: stripGenericDescription(resource.description),
    visibleText: resource.visibleText?.slice(0, 1500)
  };
}

function stripGenericDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const genericYoutubeDescription =
    "Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.";

  return value.trim() === genericYoutubeDescription ? undefined : value;
}

function toPromptTaxonomy(taxonomy: Taxonomy): Record<string, unknown> {
  return {
    areas: taxonomy.areas.map((area) => ({
      id: area.id,
      name: area.name,
      definition: truncateForPrompt(area.definition, 280)
    })),
    topics: taxonomy.topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      definition: truncateForPrompt(topic.definition, 280),
      areas: topic.areas
    })),
    projects: taxonomy.projects
      .filter((project) => (project.status ?? "active") === "active")
      .map((project) => ({
        id: project.id,
        name: project.name,
        goal: truncateForPrompt(project.goal, 280),
        areas: project.areas,
        topics: project.topics
      }))
  };
}

function truncateForPrompt(value: string | undefined, maxLength: number): string | undefined {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function parseResponsesOutputText(payload: ResponsesApiOutput): OpenAiClassification {
  const text =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((content) => content.text)?.text;

  if (!text) {
    throw new AppError("AI_INVALID_OUTPUT", "OpenAI response did not include output text.");
  }

  return JSON.parse(text) as OpenAiClassification;
}

function parseChatCompletionsOutputText(payload: ChatCompletionsOutput): OpenAiClassification {
  const text = payload.choices?.[0]?.message?.content;
  if (!text) {
    throw new AppError("AI_INVALID_OUTPUT", "OpenRouter response did not include message content.");
  }

  return JSON.parse(text) as OpenAiClassification;
}

function normalizeAiClassification(
  output: OpenAiClassification,
  taxonomy: Taxonomy,
  provider: "openai" | "openrouter"
): IntelligentClassification {
  if (!output || typeof output !== "object") {
    throw new AppError("AI_INVALID_OUTPUT", "AI classification must be an object.");
  }

  const areas = normalizeRelations(output.areas, taxonomy.areas);
  const topics = normalizeRelations(output.topics, taxonomy.topics);

  return {
    engine: provider,
    summary: requiredString(output.summary, "summary"),
    concepts: stringArray(output.concepts).slice(0, 12),
    keywords: stringArray(output.keywords).slice(0, 16),
    subjectMatter: stringArray(output.subjectMatter).slice(0, 16),
    areas,
    topics,
    projects: normalizeRelations(
      output.projects,
      taxonomy.projects.filter((project) => (project.status ?? "active") === "active")
    ),
    suggestedAreas: areas.length > 0 ? [] : normalizeSuggestedAreas(output.suggestedAreas, taxonomy.areas),
    suggestedTopics: topics.length > 0 ? [] : normalizeSuggestedTopics(output.suggestedTopics, taxonomy.areas),
    suggestedSaveIntent: saveIntents.includes(output.suggestedSaveIntent as SaveIntent)
      ? output.suggestedSaveIntent
      : undefined,
    suggestedWhySaved:
      typeof output.suggestedWhySaved === "string" && output.suggestedWhySaved.trim()
        ? output.suggestedWhySaved.trim()
        : undefined
  };
}

function normalizeSuggestedAreas(
  suggestions: NewAreaSuggestion[] | undefined,
  existingAreas: Area[]
): NewAreaSuggestion[] {
  const existingNames = new Set(existingAreas.map((area) => area.name.toLowerCase()));
  const seen = new Set<string>();
  const normalized: NewAreaSuggestion[] = [];

  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const name = requiredString(suggestion.name, "suggestedAreas.name").slice(0, 80);
    const key = name.toLowerCase();
    if (seen.has(key) || existingNames.has(key)) continue;
    seen.add(key);

    normalized.push({
      name,
      confidence: clampConfidence(suggestion.confidence),
      reason: requiredString(suggestion.reason, "suggestedAreas.reason")
    });
  }

  return normalized
    .filter((suggestion) => suggestion.confidence >= relationshipThresholds.suggested)
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
    .slice(0, 1);
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
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0 && !looksLikeIdentifier(item)
  );
}

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}

function looksLikeIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
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
    suggestedAreas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          confidence: { type: "number" },
          reason: { type: "string" }
        },
        required: ["name", "confidence", "reason"]
      }
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
    "suggestedAreas",
    "suggestedTopics",
    "suggestedSaveIntent",
    "suggestedWhySaved"
  ]
} as const;

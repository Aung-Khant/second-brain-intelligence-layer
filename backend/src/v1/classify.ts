// AI pass 2: "Where does this belong in THIS user's Second Brain?"
//
// Receives the understanding from pass 1 plus the real taxonomy, and may only
// return IDs that already exist. normalizeCandidates enforces that in code
// rather than trusting the prompt: any ID the model invents is dropped, and
// the name is taken from the taxonomy rather than from the model's output, so
// a hallucinated Topic can never reach Notion even if the model insists on it.
import type {
  CapturedResource,
  ClassificationCandidate,
  ClassificationResult,
  ResourceUnderstanding
} from "../../../shared/types/captured-resource.js";
import type { Area, Project, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import type { CorrectionHint } from "./corrections.js";
import { requestJson, toCleanString, toConfidence } from "./ai-client.js";

// Matches the "suggest" threshold in api.ts. Anything below this would render
// as an unselected row the user has to read and dismiss, which costs more
// attention than the suggestion is worth.
const noiseFloor = 0.7;

const candidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", description: "An existing ID copied exactly from the lists above." },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Decimal between 0 and 1, e.g. 0.92. Never a percentage like 92."
    },
    reason: {
      type: "string",
      description:
        "One short sentence, under 20 words. Plain text only: no double quotes, no line breaks."
    }
  },
  required: ["id", "confidence", "reason"]
} as const;

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    areas: { type: "array", items: candidateSchema },
    projects: { type: "array", items: candidateSchema },
    topics: { type: "array", items: candidateSchema }
  },
  required: ["areas", "projects", "topics"]
} as const;

type RawResult = {
  areas?: unknown;
  projects?: unknown;
  topics?: unknown;
};

export async function classifyAgainstTaxonomy(
  resource: CapturedResource,
  understanding: ResourceUnderstanding,
  taxonomy: Taxonomy,
  hints: CorrectionHint[] = []
): Promise<ClassificationResult> {
  const activeProjects = taxonomy.projects.filter((project) => project.status !== "archived");

  const output = await requestJson<RawResult>({
    schemaName: "second_brain_classification",
    schema: classificationSchema,
    prompt: buildPrompt(
      resource,
      understanding,
      taxonomy.areas,
      activeProjects,
      taxonomy.topics,
      hints
    )
  });

  return {
    areas: normalizeCandidates(output.areas, taxonomy.areas),
    projects: normalizeCandidates(output.projects, activeProjects),
    topics: normalizeCandidates(output.topics, taxonomy.topics)
  };
}

function normalizeCandidates(
  raw: unknown,
  entities: Array<Area | Project | Topic>
): ClassificationCandidate[] {
  const namesById = new Map(entities.map((entity) => [entity.id, entity.name]));
  const seen = new Set<string>();
  const candidates: ClassificationCandidate[] = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "object" || item === null) continue;

    const { id, confidence, reason } = item as Record<string, unknown>;
    if (typeof id !== "string") continue;

    const name = namesById.get(id);
    if (!name || seen.has(id)) continue;

    const score = toConfidence(confidence);
    // The prompt asks the model not to return anything this weak, but models
    // hedge. Enforcing the floor here keeps low-signal noise out of the popup
    // regardless of how the model behaves.
    if (score < noiseFloor) continue;

    seen.add(id);
    candidates.push({
      id,
      name,
      confidence: score,
      reason: toCleanString(reason, "Matched by the classifier.")
    });
  }

  return candidates.sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name)
  );
}

function buildPrompt(
  resource: CapturedResource,
  understanding: ResourceUnderstanding,
  areas: Area[],
  projects: Project[],
  topics: Topic[],
  hints: CorrectionHint[]
): string {
  return [
    "You file a resource into an existing personal Second Brain.",
    "",
    "RULES",
    "- Choose only from the existing Areas, Projects, and Topics listed below.",
    "- Copy IDs exactly. Never invent an ID, a name, or a new category.",
    "- If nothing genuinely fits a group, return an empty array for it. An empty array is a correct, expected answer.",
    "- Do not force a match. A wrong classification is worse than no classification.",
    "- Areas are broad and stable; usually 1, occasionally 2.",
    "- Only pick a Project when the resource would actually help move that specific work forward.",
    "- Topics may have several genuine matches. Include each one that truly fits.",
    "- Keep every reason to one short plain-text sentence. Never put a double quote,",
    "  an apostrophe-heavy phrase, or a line break inside a reason - it breaks the JSON.",
    "",
    "THE OVERLAP TEST - apply to every candidate before including it",
    "Ask: is this resource ABOUT the entity, or does it merely share a word or a broad field with it?",
    "Only 'about' qualifies. Some worked examples:",
    "- A video on animating math visualisations is NOT about 'Content Strategy' just because both involve making content.",
    "- A video on vector databases is NOT about 'Web Development' just because vector databases get used in web apps.",
    "- A video on vector databases IS about 'Retrieval' and 'Embeddings' - those are its actual subject.",
    "If your reason would be 'both relate to X broadly', omit the candidate entirely.",
    "",
    "CONFIDENCE (decimal 0 to 1, never a percentage)",
    "- 0.90 and above: the resource is unmistakably, centrally about this entity. Auto-selected for the user.",
    "- 0.70 to 0.89: clearly relevant and worth suggesting, but the user decides.",
    "- Below 0.70: do not return it at all. Weak guesses cost the user more than a missing suggestion.",
    "",
    ...buildHintSection(hints),
    resource.sourceType === "youtube_channel"
      ? "RESOURCE (a YouTube channel - file it by what it publishes over time, not one video)"
      : "RESOURCE (a single YouTube video)",
    // The title and channel are the strongest and most literal signals there
    // are - far more reliable than a generated summary. Pass 1 deliberately
    // never saw the taxonomy, so these are re-supplied here rather than being
    // lost between the two passes.
    `${resource.sourceType === "youtube_channel" ? "Channel name" : "Title"}: ${resource.title ?? "(unknown)"}`,
    resource.sourceType === "youtube_channel"
      ? ""
      : `Channel: ${resource.creator ?? "(unknown)"}`,
    `Summary: ${understanding.summary}`,
    `Category: ${understanding.contentCategory}`,
    `Core ideas: ${understanding.coreIdeas.join(", ") || "(none identified)"}`,
    `Likely use cases: ${understanding.likelyUseCases.join(", ") || "(none identified)"}`,
    "",
    "EXISTING AREAS",
    formatEntities(areas.map((area) => ({ id: area.id, name: area.name, detail: area.definition }))),
    "",
    "EXISTING ACTIVE PROJECTS",
    formatEntities(
      projects.map((project) => ({ id: project.id, name: project.name, detail: project.goal }))
    ),
    "",
    "EXISTING TOPICS",
    formatEntities(
      topics.map((topic) => ({ id: topic.id, name: topic.name, detail: topic.definition }))
    ),
    "",
    "Return JSON matching the required schema."
  ].join("\n");
}

function buildHintSection(hints: CorrectionHint[]): string[] {
  if (hints.length === 0) return [];

  return [
    "PAST USER CORRECTIONS",
    "Treat these as evidence about this user's filing habits, not as rules. They describe",
    "different resources and may not apply here. Never pick an entity just because it appears below.",
    ...hints.map((hint) => `- ${hint.summary}`),
    ""
  ];
}

function formatEntities(
  entities: Array<{ id: string; name: string; detail?: string }>
): string {
  if (entities.length === 0) return "(none)";

  return entities
    .map((entity) => {
      const detail = entity.detail?.trim().slice(0, 200);
      return `- ${entity.name} [id: ${entity.id}]${detail ? ` - ${detail}` : ""}`;
    })
    .join("\n");
}

// AI pass 2: "Where does this belong in THIS user's Second Brain?"
//
// Receives the understanding from pass 1 plus the real taxonomy, and may only
// return IDs that already exist. normalizeCandidates enforces that in code
// rather than trusting the prompt: any ID the model invents is dropped, and
// the name is taken from the taxonomy rather than from the model's output, so
// a hallucinated Topic can never reach Notion even if the model insists on it.
import type {
  ClassificationCandidate,
  ClassificationResult,
  ResourceUnderstanding
} from "../../../shared/types/captured-resource.js";
import type { Area, Project, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import type { CorrectionHint } from "./corrections.js";
import { requestJson, toCleanString, toConfidence } from "./ai-client.js";

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
    reason: { type: "string", description: "One short sentence, under 20 words." }
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
  understanding: ResourceUnderstanding,
  taxonomy: Taxonomy,
  hints: CorrectionHint[] = []
): Promise<ClassificationResult> {
  const activeProjects = taxonomy.projects.filter((project) => project.status !== "archived");

  const output = await requestJson<RawResult>({
    schemaName: "second_brain_classification",
    schema: classificationSchema,
    prompt: buildPrompt(understanding, taxonomy.areas, activeProjects, taxonomy.topics, hints)
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

    seen.add(id);
    candidates.push({
      id,
      name,
      confidence: toConfidence(confidence),
      reason: toCleanString(reason, "Matched by the classifier.")
    });
  }

  return candidates.sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name)
  );
}

function buildPrompt(
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
    "- Do not match on a generic shared word alone. The resource must really be about the entity.",
    "",
    "CONFIDENCE (decimal 0 to 1, never a percentage)",
    "- 0.90 and above: unambiguous, direct match. This will be auto-selected for the user.",
    "- 0.70 to 0.89: strong match worth suggesting, but the user decides.",
    "- Below 0.70: plausible but weak. Include it only if it is genuinely relevant.",
    "",
    ...buildHintSection(hints),
    "RESOURCE",
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

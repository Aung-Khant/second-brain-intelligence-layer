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
  EntityProposal,
  ClassificationResult,
  ResourceUnderstanding
} from "../../../shared/types/captured-resource.js";
import type { Area, Project, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";
import type { CorrectionHint } from "./corrections.js";
import { requestJson, toCleanString, toConfidence } from "./ai-client.js";

// Matches the "suggest" threshold in api.ts. Anything below this would render
// as an unselected row the user has to read and dismiss, which costs more
// attention than the suggestion is worth.
const noiseFloor = 0.8;

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

const proposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description:
        "A short, durable category name in the same style as the existing ones. Title Case, 1-3 words."
    },
    reason: {
      type: "string",
      description:
        "One short sentence, under 20 words. Plain text only: no double quotes, no line breaks."
    }
  },
  required: ["name", "reason"]
} as const;

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    areas: { type: "array", items: candidateSchema },
    projects: { type: "array", items: candidateSchema },
    topics: { type: "array", items: candidateSchema },
    newAreas: { type: "array", items: proposalSchema },
    newTopics: { type: "array", items: proposalSchema }
  },
  required: ["areas", "projects", "topics", "newAreas", "newTopics"]
} as const;

type RawResult = {
  areas?: unknown;
  projects?: unknown;
  topics?: unknown;
  newAreas?: unknown;
  newTopics?: unknown;
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
    topics: normalizeCandidates(output.topics, taxonomy.topics),
    proposals: {
      // One Area at most: Areas are broad and stable, and a workspace that
      // grows one per video isn't a taxonomy any more. Topics are finer, so a
      // couple is reasonable.
      areas: normalizeProposals(output.newAreas, taxonomy.areas, 1),
      topics: normalizeProposals(output.newTopics, taxonomy.topics, 3)
    }
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

// Proposals are names, not IDs, so they can't be validated against the
// taxonomy the way candidates are. Anything that already exists is dropped -
// suggesting the user create a duplicate of something they have is worse than
// suggesting nothing.
function normalizeProposals(
  raw: unknown,
  existing: { name: string }[],
  limit: number
): EntityProposal[] {
  const taken = new Set(existing.map((entity) => entity.name.trim().toLowerCase()));
  const proposals: EntityProposal[] = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "object" || item === null) continue;

    const { name, reason } = item as Record<string, unknown>;
    if (typeof name !== "string") continue;

    const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 80);
    const key = cleaned.toLowerCase();
    if (!cleaned || taken.has(key)) continue;

    taken.add(key);
    proposals.push({
      name: cleaned,
      reason: toCleanString(reason, "Suggested as a new category.")
    });

    if (proposals.length >= limit) break;
  }

  return proposals;
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
    "- areas, projects, and topics may contain ONLY entities from the lists below.",
    "- Copy IDs exactly. Never invent an ID. Anything you want to suggest that does not",
    "  already exist belongs in newAreas or newTopics instead, described further down.",
    "- If nothing genuinely fits a group, return an empty array for it. An empty array is a correct, expected answer.",
    "- Do not force a match. A wrong classification is worse than no classification.",
    "- Areas are broad and stable; usually 1, occasionally 2.",
    "- An Area naming a FIELD only matches a resource actually in that field. Fields are",
    "  not interchangeable just because both are academic, technical, or scientific:",
    "  a chemistry resource does not belong to 'Maths', and a biology resource does not",
    "  belong to 'Computer Science'. If the resource's field has no Area, return no Area",
    "  match for it and propose the right one in newAreas instead.",
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
    "- A chemistry tutorial is NOT about 'Maths' just because both are studied subjects.",
    "- A hardware tutorial is NOT about 'Study Skills' just because it teaches something.",
    "  'Study Skills' means learning technique itself, not any resource you learn from.",
    "- An introduction to a tool is NOT about every application of that tool. A beginner",
    "  Arduino video is not about 'Automation' merely because Arduinos can automate things;",
    "  it would have to actually be about automating something.",
    "- A video on vector databases IS about 'Retrieval' and 'Embeddings' - those are its actual subject.",
    "If your reason would be 'both relate to X broadly', omit the candidate entirely.",
    "",
    "PROPOSING NEW CATEGORIES (newAreas, newTopics)",
    "The lists above are the user's whole taxonomy, and it is still small. When this",
    "resource genuinely belongs to something they haven't created yet, propose it.",
    "- Propose only what is missing. If an existing entity already fits, use it and propose nothing.",
    "- At most 1 Area and at most 3 Topics. Usually fewer. Often none at all.",
    "- Propose a category, not a label for this one resource. It must be somewhere",
    "  dozens of future resources could sit. 'Mathematics' yes; 'Taylor Series for ln(x)' no.",
    "- Match the style of what exists: short, Title Case, one to three words.",
    "- An Area is a broad, lasting part of the user's life or work. Propose one whenever",
    "  the resource's field has no Area of its own. This will be common while the list is",
    "  short, and that is correct - it is how the taxonomy fills in.",
    "- Apply this one test for newAreas, every single time:",
    "",
    "    Name the resource's specific field in one word or two. Chemistry. Mathematics.",
    "    Cooking. Personal Finance. Then ask: is there an existing Area that NAMES that",
    "    field? If no, put that field in newAreas. If yes, propose nothing.",
    "",
    "  Run the test on its own. Whether you matched an Area above is irrelevant to it -",
    "  'Learning', 'General', and 'Misc' describe a mode of use, not a field, so matching",
    "  one of them never answers the question. A chemistry video matched to 'Learning'",
    "  still has no Area naming chemistry, so 'Chemistry' goes in newAreas. Selecting the",
    "  catch-all AND proposing the field is the expected result, not a contradiction.",
    "- Name a proposed Area at the level of a field or a lasting responsibility -",
    "  'Chemistry', 'Design', 'Personal Finance' - never at the level of one resource.",
    "- Never propose a near-duplicate of something listed above under a different name.",
    "- Do not propose new Projects. A project is something the user decides to start, not",
    "  something inferred from a video.",
    "",
    "CONFIDENCE (decimal 0 to 1, never a percentage)",
    "- 0.90 and above: the resource is unmistakably, centrally about this entity. Auto-selected for the user.",
    "- 0.80 to 0.89: clearly relevant and worth suggesting, but the user decides.",
    "- Below 0.80: do not return it at all. Weak guesses cost the user more than a missing suggestion.",
    "  A tangential connection is not worth 0.80. If you are reaching, leave it out.",
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

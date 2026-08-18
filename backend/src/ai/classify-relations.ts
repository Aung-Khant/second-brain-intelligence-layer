// The local (non-AI) matcher: scores every existing Area/Topic/Project
// independently against the resource's text using literal keyword overlap,
// no network calls. Each candidate's confidence is computed on its own, so a
// resource can legitimately preselect more than one Area/Topic/Project when
// each clears the threshold - this is what makes local classify fast and
// deterministic, at the cost of missing anything that needs real semantic
// understanding (that's what AI Enhance is for).
import { relationshipThresholds } from "../config/classification.js";
import { normalizeText } from "./understand-resource.js";
import type {
  ClassifiedResource,
  RelationSuggestion,
  ResourceUnderstanding,
  TrustedResourceInput
} from "../../../shared/types/resource.js";
import type { Area, Project, Taxonomy, Topic } from "../../../shared/types/taxonomy.js";

type Candidate = {
  id: string;
  name: string;
  text: string;
  kind: "area" | "topic" | "project";
};

type MatchResult = {
  confidence: number;
  reason: string;
};

export function classifyRelations(
  resource: TrustedResourceInput,
  understanding: ResourceUnderstanding,
  taxonomy: Taxonomy
): ClassifiedResource {
  const resourceBag = buildRelationText(resource, understanding);

  return {
    ...understanding,
    areas: taxonomy.areas
      .map((area) => scoreArea(area, resourceBag))
      .filter(isVisible)
      .sort(sortRelations),
    topics: taxonomy.topics
      .map((topic) => scoreTopic(topic, resourceBag))
      .filter(isVisible)
      .sort(sortRelations),
    projects: taxonomy.projects
      .filter((project) => (project.status ?? "active") === "active")
      .map((project) => scoreProject(project, resourceBag))
      .filter(isVisible)
      .sort(sortRelations)
  };
}

function buildRelationText(
  resource: TrustedResourceInput,
  understanding: ResourceUnderstanding
): string {
  const shouldUseVisibleText =
    resource.type !== "youtube_video" && resource.type !== "youtube_channel";

  return normalizeText(
    [
      resource.title,
      resource.creator,
      resource.description,
      shouldUseVisibleText ? resource.visibleText : "",
      understanding.summary,
      understanding.concepts.join(" "),
      understanding.keywords.join(" "),
      understanding.subjectMatter.join(" ")
    ].join(" ")
  );
}

function scoreArea(area: Area, resourceBag: string): RelationSuggestion {
  return toSuggestion(area.id, area.name, scoreCandidate(toAreaCandidate(area), resourceBag));
}

function scoreTopic(topic: Topic, resourceBag: string): RelationSuggestion {
  return toSuggestion(topic.id, topic.name, scoreCandidate(toTopicCandidate(topic), resourceBag));
}

function scoreProject(project: Project, resourceBag: string): RelationSuggestion {
  return toSuggestion(project.id, project.name, scoreCandidate(toProjectCandidate(project), resourceBag));
}

function scoreCandidate(candidate: Candidate, resourceBag: string): MatchResult {
  const candidateTokens = significantTokens(candidate.text);
  const nameTokens = significantTokens(candidate.name);
  const matchedNameTokens = nameTokens.filter((token) => resourceBag.includes(token));
  const matchedDefinitionTokens = candidateTokens.filter((token) => resourceBag.includes(token));
  const exactName = resourceBag.includes(normalizeText(candidate.name));

  let confidence = 0;
  if (exactName) confidence += candidate.kind === "project" ? 45 : 55;
  confidence += matchedNameTokens.length * 20;
  confidence += matchedDefinitionTokens.length * 12;

  if (candidate.kind === "area" && matchedDefinitionTokens.length >= 3) {
    confidence = Math.max(confidence, 90);
  }

  if (candidate.kind === "topic" && matchedDefinitionTokens.length >= 4) {
    confidence = Math.max(confidence, 86);
  }

  if (candidate.kind === "project" && matchedDefinitionTokens.length >= 4) {
    confidence = Math.max(confidence, 80);
  }

  if (candidate.kind === "project" && matchedNameTokens.length === 0 && !exactName) {
    confidence = Math.max(0, confidence - 20);
  }

  confidence = Math.min(100, confidence);

  if (confidence < relationshipThresholds.suggested) {
    return {
      confidence,
      reason: `Only weak direct evidence matched ${candidate.name}.`
    };
  }

  const evidence = Array.from(new Set([...matchedNameTokens, ...matchedDefinitionTokens]))
    .slice(0, 5)
    .join(", ");

  return {
    confidence,
    reason: exactName
      ? `The resource directly names ${candidate.name}.`
      : `The resource directly matches ${candidate.name} through: ${evidence}.`
  };
}

function toSuggestion(
  entityId: string,
  entityName: string,
  result: MatchResult
): RelationSuggestion {
  return {
    entityId,
    entityName,
    confidence: result.confidence,
    reason: result.reason,
    state:
      result.confidence >= relationshipThresholds.preselected
        ? "preselected"
        : result.confidence >= relationshipThresholds.suggested
          ? "suggested"
          : "hidden"
  };
}

function isVisible(relation: RelationSuggestion): boolean {
  return relation.state !== "hidden";
}

function sortRelations(a: RelationSuggestion, b: RelationSuggestion): number {
  return b.confidence - a.confidence || a.entityName.localeCompare(b.entityName);
}

function toAreaCandidate(area: Area): Candidate {
  return {
    id: area.id,
    name: area.name,
    kind: "area",
    text: [area.name, area.definition].filter(Boolean).join(" ")
  };
}

function toTopicCandidate(topic: Topic): Candidate {
  return {
    id: topic.id,
    name: topic.name,
    kind: "topic",
    text: [topic.name, topic.definition].filter(Boolean).join(" ")
  };
}

function toProjectCandidate(project: Project): Candidate {
  return {
    id: project.id,
    name: project.name,
    kind: "project",
    text: [
      project.name,
      project.goal,
      project.problem,
      project.audience,
      project.areas?.join(" "),
      project.topics?.join(" ")
    ]
      .filter(Boolean)
      .join(" ")
  };
}

function significantTokens(text: string): string[] {
  const ignored = new Set([
    "and",
    "are",
    "build",
    "clear",
    "create",
    "from",
    "goal",
    "how",
    "market",
    "old",
    "product",
    "system",
    "systems",
    "the",
    "that",
    "this",
    "with"
  ]);

  return Array.from(
    new Set(
      normalizeText(text)
        .split(/\s+/)
        .flatMap((token) => [token, stemToken(token)])
        .filter((token) => token.length >= 4 && !ignored.has(token))
    )
  );
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

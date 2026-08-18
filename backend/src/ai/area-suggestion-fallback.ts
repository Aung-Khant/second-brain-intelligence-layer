import type {
  IntelligentClassification,
  NewAreaSuggestion,
  RelationSuggestion,
  TrustedResourceInput
} from "../../../shared/types/resource.js";
import type { Area, Taxonomy } from "../../../shared/types/taxonomy.js";
import { normalizeText } from "./understand-resource.js";

type AreaCategory = {
  newAreaName: string;
  evidence: string;
  keywords: string[];
  areaPatterns: RegExp[];
};

const categories: AreaCategory[] = [
  {
    newAreaName: "Technology & Tools",
    evidence: "software, devices, AI, or digital tools",
    keywords: [
      "ai",
      "app",
      "code",
      "computer",
      "device",
      "digital",
      "display",
      "e ink",
      "e-ink",
      "hardware",
      "programming",
      "screen",
      "software",
      "technology"
    ],
    areaPatterns: [/computer/i, /technology/i, /\btech\b/i, /software/i, /\bai\b/i, /digital/i]
  },
  {
    newAreaName: "Learning & Education",
    evidence: "learning, studying, memory, or education",
    keywords: ["cognitive", "education", "learn", "learning", "memory", "school", "study"],
    areaPatterns: [/learning/i, /cognitive/i, /education/i, /school/i]
  },
  {
    newAreaName: "Business & Entrepreneurship",
    evidence: "business, products, markets, or entrepreneurship",
    keywords: ["business", "company", "entrepreneur", "market", "product", "startup"],
    areaPatterns: [/business/i, /entrepreneur/i, /startup/i, /career/i]
  },
  {
    newAreaName: "Finance & Investing",
    evidence: "finance, money, investing, or markets",
    keywords: ["finance", "invest", "investing", "money", "portfolio", "stock"],
    areaPatterns: [/finance/i, /invest/i, /money/i]
  },
  {
    newAreaName: "Mathematics & Science",
    evidence: "math, science, physics, or biology",
    keywords: ["algebra", "biology", "calculus", "math", "physics", "science"],
    areaPatterns: [/math/i, /science/i, /physics/i, /biology/i]
  },
  {
    newAreaName: "Creative Work",
    evidence: "design, writing, video, or creative production",
    keywords: ["animation", "creative", "design", "video", "writing"],
    areaPatterns: [/creative/i, /design/i, /writing/i, /media/i]
  }
];

export function ensureAreaSuggestion(
  classification: IntelligentClassification,
  resource: TrustedResourceInput,
  taxonomy: Taxonomy
): IntelligentClassification {
  if (classification.areas.length > 0 || classification.suggestedAreas.length > 0) {
    return classification;
  }

  const category = firstMatchingCategory(classification, resource);
  if (!category) {
    return classification;
  }

  const existingArea = findExistingArea(category, taxonomy.areas);
  if (existingArea) {
    return {
      ...classification,
      areas: [toExistingAreaSuggestion(existingArea, category)]
    };
  }

  return {
    ...classification,
    suggestedAreas: [toNewAreaSuggestion(category)]
  };
}

function firstMatchingCategory(
  classification: IntelligentClassification,
  resource: TrustedResourceInput
): AreaCategory | undefined {
  const bag = normalizeText(
    [
      resource.title,
      resource.creator,
      resource.description,
      resource.visibleText,
      classification.summary,
      classification.concepts.join(" "),
      classification.keywords.join(" "),
      classification.subjectMatter.join(" ")
    ].join(" ")
  );

  return categories.find((category) =>
    category.keywords.some((keyword) => bag.includes(normalizeText(keyword)))
  );
}

function findExistingArea(category: AreaCategory, areas: Area[]): Area | undefined {
  return (
    areas.find((area) => matchesCategory(area.name, category)) ??
    areas.find((area) => matchesCategory([area.name, area.definition].filter(Boolean).join(" "), category))
  );
}

function matchesCategory(text: string, category: AreaCategory): boolean {
  return category.areaPatterns.some((pattern) => pattern.test(text));
}

function toExistingAreaSuggestion(area: Area, category: AreaCategory): RelationSuggestion {
  return {
    entityId: area.id,
    entityName: area.name,
    confidence: 82,
    reason: `Suggested because this resource appears to be about ${category.evidence}.`,
    state: "suggested"
  };
}

function toNewAreaSuggestion(category: AreaCategory): NewAreaSuggestion {
  return {
    name: category.newAreaName,
    confidence: 80,
    reason: `No existing Area matched clearly; this resource appears to be about ${category.evidence}.`
  };
}

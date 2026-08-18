import test from "node:test";
import assert from "node:assert/strict";
import { ensureAreaSuggestion } from "../backend/src/ai/area-suggestion-fallback.js";
import type { IntelligentClassification, TrustedResourceInput } from "../shared/types/resource.js";
import type { Taxonomy } from "../shared/types/taxonomy.js";

const baseResource: TrustedResourceInput = {
  type: "youtube_video",
  title: "WAIT E-Ink was FAST this WHOLE Time?!",
  description: "A video about fast E-Ink display technology and a new hardware device."
};

const baseClassification: IntelligentClassification = {
  engine: "local",
  summary: "A video about fast E-Ink display technology.",
  concepts: ["E-Ink", "Display Technology"],
  keywords: ["display", "technology", "hardware"],
  subjectMatter: ["E-Ink", "Display Technology"],
  areas: [],
  topics: [],
  projects: [],
  suggestedAreas: [],
  suggestedTopics: []
};

test("suggests an existing broad Area when one fits the resource", () => {
  const taxonomy: Taxonomy = {
    areas: [
      {
        id: "area-cs-ai",
        name: "Computer Science & AI",
        definition: "Software, hardware, AI, digital systems, and technical tools."
      }
    ],
    topics: [],
    projects: []
  };

  const output = ensureAreaSuggestion(baseClassification, baseResource, taxonomy);

  assert.deepEqual(output.suggestedAreas, []);
  assert.equal(output.areas.length, 1);
  assert.equal(output.areas[0]?.entityId, "area-cs-ai");
  assert.equal(output.areas[0]?.state, "suggested");
});

test("offers one new Area suggestion when no existing broad Area fits", () => {
  const taxonomy: Taxonomy = {
    areas: [
      {
        id: "area-health",
        name: "Health",
        definition: "Fitness, nutrition, sleep, and personal wellness."
      }
    ],
    topics: [],
    projects: []
  };

  const output = ensureAreaSuggestion(baseClassification, baseResource, taxonomy);

  assert.deepEqual(output.areas, []);
  assert.deepEqual(output.suggestedAreas.map((area) => area.name), ["Technology & Tools"]);
});

test("does not add extra Area suggestions when a classifier result already has one", () => {
  const existingClassification: IntelligentClassification = {
    ...baseClassification,
    areas: [
      {
        entityId: "area-learning",
        entityName: "Learning & Cognitive Science",
        confidence: 90,
        reason: "The resource directly matches Learning & Cognitive Science.",
        state: "preselected"
      }
    ]
  };

  const output = ensureAreaSuggestion(existingClassification, baseResource, {
    areas: [],
    topics: [],
    projects: []
  });

  assert.equal(output.areas.length, 1);
  assert.deepEqual(output.suggestedAreas, []);
});

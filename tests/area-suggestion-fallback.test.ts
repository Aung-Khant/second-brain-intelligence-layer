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

test("ignores noisy YouTube page text so an unrelated video doesn't get a Technology suggestion", () => {
  const youtubeResource: TrustedResourceInput = {
    type: "youtube_video",
    title: "Omniman Destroys flaxan's planet - Animated Lyric video",
    creator: "JuanVisuals",
    description:
      "This is an animated lyric video depicting the scene from the show Invincible where Omni-Man destroys the planet Flaxan. It is a fan-made animation set to music.",
    visibleText: "Get the app on your device. AI recommendations, technology news, and screen settings."
  };

  const youtubeClassification: IntelligentClassification = {
    ...baseClassification,
    summary: "An animated lyric video about Omni-Man destroying the planet Flaxan.",
    concepts: [],
    keywords: ["animated", "lyric", "planet", "video", "animation"],
    subjectMatter: ["animated", "lyric", "planet", "video"]
  };

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

  const output = ensureAreaSuggestion(youtubeClassification, youtubeResource, taxonomy);

  assert.deepEqual(output.areas, []);
});

test("still uses page text for a non-YouTube webpage", () => {
  const webpageResource: TrustedResourceInput = {
    type: "webpage",
    title: "A Blog Post",
    visibleText: "Get the app on your device. AI recommendations, technology news, and screen settings."
  };

  const webpageClassification: IntelligentClassification = {
    ...baseClassification,
    summary: "A blog post.",
    concepts: [],
    keywords: [],
    subjectMatter: []
  };

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

  const output = ensureAreaSuggestion(webpageClassification, webpageResource, taxonomy);

  assert.equal(output.areas.length, 1);
  assert.equal(output.areas[0]?.entityId, "area-cs-ai");
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

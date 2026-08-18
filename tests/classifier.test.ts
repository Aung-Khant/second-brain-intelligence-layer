import test from "node:test";
import assert from "node:assert/strict";
import { classifyResource } from "../backend/src/ai/classify-resource.js";
import { mockTaxonomy } from "../backend/src/retrieval/mock-taxonomy.js";
import type { Taxonomy } from "../shared/types/taxonomy.js";

test("returns one strong area for a memory article", () => {
  const output = classifyResource({
    resource: {
      type: "article",
      title: "How Spaced Repetition Strengthens Memory",
      description: "Memory, forgetting, retrieval practice, attention, and learning."
    },
    taxonomy: mockTaxonomy
  });

  assert.deepEqual(output.areas.map((area) => area.entityName), ["Cognitive Science"]);
  assert.equal(output.areas[0]?.state, "preselected");
});

test("returns multiple strong areas when direct evidence supports them", () => {
  const output = classifyResource({
    resource: {
      type: "article",
      title: "Mathematical Algorithms for Computer Science",
      description: "A programming article about algorithms, computation, proof, and mathematical reasoning."
    },
    taxonomy: mockTaxonomy
  });

  assert.ok(output.areas.some((area) => area.entityName === "Mathematics"));
  assert.ok(output.areas.some((area) => area.entityName === "Computer Science"));
});

test("returns no areas for unrelated resources", () => {
  const output = classifyResource({
    resource: {
      type: "webpage",
      title: "Weekend Hiking Gear Checklist",
      description: "A practical packing list for trail snacks, rain layers, and day hikes."
    },
    taxonomy: mockTaxonomy
  });

  assert.deepEqual(output.areas, []);
});

test("returns strong topic matches", () => {
  const output = classifyResource({
    resource: {
      type: "youtube_video",
      title: "Eigenvectors and Linear Algebra Visually Explained",
      description: "A visual explanation of matrices, transformations, and eigenvectors."
    },
    taxonomy: mockTaxonomy
  });

  assert.ok(output.topics.some((topic) => topic.entityName === "Linear Algebra"));
  assert.ok(output.topics.some((topic) => topic.entityName === "Mathematical Visualization"));
});

test("does not force a topic when no existing topic fits", () => {
  const output = classifyResource({
    resource: {
      type: "article",
      title: "A Guide to Coffee Brewing",
      description: "Water temperature, grind size, and extraction ratio for better coffee."
    },
    taxonomy: mockTaxonomy
  });

  assert.deepEqual(output.topics, []);
});

test("ignores noisy YouTube page text for relation matching", () => {
  const output = classifyResource({
    resource: {
      type: "youtube_video",
      title: "WAIT E-Ink was FAST this WHOLE Time?!",
      description: "",
      visibleText:
        "recommended videos about business products, market systems, learning strategies, memory, brain science, and unrelated AI tools."
    },
    taxonomy: mockTaxonomy
  });

  assert.deepEqual(output.areas, []);
  assert.deepEqual(output.topics, []);
});

test("strips generic YouTube boilerplate from local summaries", () => {
  const output = classifyResource({
    resource: {
      type: "youtube_video",
      title: "(85) I'm a Doctor with ADHD: How I Really Focus - YouTube",
      description:
        "Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube."
    },
    taxonomy: mockTaxonomy
  });

  assert.equal(output.summary, "YouTube video: I'm a Doctor with ADHD: How I Really Focus.");
});

test("uses article page text for relation matching", () => {
  const output = classifyResource({
    resource: {
      type: "article",
      title: "Field Notes",
      description: "",
      visibleText:
        "A practical guide to memory, attention, retrieval practice, and learning for stronger recall."
    },
    taxonomy: mockTaxonomy
  });

  assert.ok(output.areas.some((area) => area.entityName === "Cognitive Science"));
  assert.ok(output.topics.some((topic) => topic.entityName === "Memory"));
});

test("does not suggest unrelated projects", () => {
  const output = classifyResource({
    resource: {
      type: "article",
      title: "Startup Pricing Strategy",
      description: "A business article about markets, customers, products, and pricing strategy."
    },
    taxonomy: mockTaxonomy
  });

  assert.deepEqual(output.projects, []);
});

test("supports multiple active projects when direct evidence supports them", () => {
  const taxonomy: Taxonomy = {
    ...mockTaxonomy,
    projects: [
      ...mockTaxonomy.projects,
      {
        id: "project-linear-course",
        name: "Build Linear Algebra Course",
        goal: "Create a visual linear algebra course using eigenvectors and mathematical visualization.",
        areas: ["Mathematics"],
        topics: ["Linear Algebra", "Mathematical Visualization"],
        status: "active"
      }
    ]
  };

  const output = classifyResource({
    resource: {
      type: "youtube_video",
      title: "Eigenvectors and Linear Algebra Visually Explained",
      description: "A visual explanation of matrices, transformations, and eigenvectors."
    },
    taxonomy
  });

  assert.ok(output.projects.some((project) => project.entityName === "Create Eigenvector Animation"));
  assert.ok(output.projects.some((project) => project.entityName === "Build Linear Algebra Course"));
});

test("supports empty valid relationship arrays", () => {
  const output = classifyResource({
    resource: {
      type: "youtube_channel",
      title: "3Blue1Brown",
      creator: "Grant Sanderson",
      description: "Visual explanations of mathematics."
    },
    taxonomy: {
      areas: [],
      topics: [],
      projects: []
    }
  });

  assert.deepEqual(output.areas, []);
  assert.deepEqual(output.topics, []);
  assert.deepEqual(output.projects, []);
});

test("rejects unsupported resource types", () => {
  assert.throws(
    () =>
      classifyResource({
        resource: {
          // Runtime validation protects the boundary before extension extraction exists.
          type: "pdf",
          title: "A PDF"
        } as never,
        taxonomy: mockTaxonomy
      }),
    /Unsupported resource type/
  );
});

test("rejects missing metadata", () => {
  assert.throws(
    () =>
      classifyResource({
        resource: {
          type: "article",
          title: ""
        },
        taxonomy: mockTaxonomy
      }),
    /Resource title is required/
  );
});

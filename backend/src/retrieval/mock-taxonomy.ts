// A small hand-written taxonomy used by the plain `classify` CLI, the test
// suite, and `evaluate` (without --notion) when you don't want to hit real
// Notion. Names here were originally seeded from the developer's real
// workspace, which is why they show up again as real IDs when testing
// against the live Notion taxonomy.
import type { Taxonomy } from "../../../shared/types/taxonomy.js";

export const mockTaxonomy: Taxonomy = {
  areas: [
    {
      id: "area-math",
      name: "Mathematics",
      definition:
        "Study of math, mathematical quantity, structure, space, change, proof, reasoning, and visual mathematical communication."
    },
    {
      id: "area-cs",
      name: "Computer Science",
      definition:
        "Computer science, software, algorithms, programming, computation, artificial intelligence, machine learning, computer vision, image recognition, Python, and technical systems."
    },
    {
      id: "area-business",
      name: "Business",
      definition:
        "Company building, strategy, markets, products, customers, operations, and entrepreneurship."
    },
    {
      id: "area-cogsci",
      name: "Cognitive Science",
      definition:
        "Cognitive science, learning, memory, attention, perception, reasoning, language, speech, pronunciation, spoken audio, and human cognition."
    }
  ],
  topics: [
    {
      id: "topic-linear-algebra",
      name: "Linear Algebra",
      definition: "Vectors, matrices, transformations, eigenvectors, eigenspaces, and related visual intuition.",
      areas: ["Mathematics"]
    },
    {
      id: "topic-manim",
      name: "Manim",
      definition: "Python animation engine for precise mathematical videos and explanatory animations.",
      areas: ["Mathematics", "Computer Science"]
    },
    {
      id: "topic-memory",
      name: "Memory",
      definition: "How information is encoded, retained, retrieved, forgotten, and strengthened over time.",
      areas: ["Cognitive Science"]
    },
    {
      id: "topic-computer-vision",
      name: "Computer Vision",
      definition: "Techniques for machine perception, image recognition, visual understanding, and video analysis.",
      areas: ["Computer Science"]
    },
    {
      id: "topic-math-visualization",
      name: "Mathematical Visualization",
      definition:
        "Visual explanation, visual explanations, visuals, animations, animated intuition, mathematical videos, explanatory animations, matrices, transformations, eigenvectors, diagrams, and geometry for explaining abstract mathematics.",
      areas: ["Mathematics"]
    }
  ],
  projects: [
    {
      id: "project-eigenvector-animation",
      name: "Create Eigenvector Animation",
      goal: "Create a clear visual explanation of eigenvectors and linear transformations.",
      areas: ["Mathematics"],
      topics: ["Linear Algebra", "Mathematical Visualization"],
      status: "active"
    },
    {
      id: "project-pronunciation-detector",
      name: "Build Pronunciation Error Detector",
      goal: "Build a system that detects pronunciation mistakes from spoken audio.",
      areas: ["Computer Science", "Cognitive Science"],
      topics: ["Computer Vision"],
      status: "active"
    },
    {
      id: "project-transfer-application",
      name: "Complete University Transfer Application",
      goal: "Finish and submit a strong university transfer application.",
      areas: ["Business"],
      topics: [],
      status: "active"
    },
    {
      id: "project-old-math-notes",
      name: "Archive Old Math Notes",
      goal: "Clean up historical math notes.",
      areas: ["Mathematics"],
      topics: ["Linear Algebra"],
      status: "archived"
    }
  ]
};

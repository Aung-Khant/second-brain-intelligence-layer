import test from "node:test";
import assert from "node:assert/strict";
import { classifyResourceWithOpenAi } from "../backend/src/ai/openai-classify-resource.js";
import { mockTaxonomy } from "../backend/src/retrieval/mock-taxonomy.js";

test("rescales a 0-1 AI confidence instead of silently dropping the relation", async () => {
  const previousFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  const previousKey = process.env.OPENROUTER_API_KEY;

  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";

  const topic = mockTaxonomy.topics[0]!;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "A test resource summary.",
                concepts: [],
                keywords: [],
                subjectMatter: [],
                areas: [],
                topics: [
                  {
                    entityId: topic.id,
                    confidence: 0.92,
                    reason: "Direct match on the topic name."
                  }
                ],
                projects: [],
                suggestedAreas: [],
                suggestedTopics: [],
                suggestedSaveIntent: "learn",
                suggestedWhySaved: "It matches the topic directly."
              })
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const result = await classifyResourceWithOpenAi(
      { type: "article", title: "Test Resource", description: "Test description." },
      mockTaxonomy
    );

    assert.equal(result.topics.length, 1);
    assert.equal(result.topics[0]?.entityId, topic.id);
    assert.equal(result.topics[0]?.confidence, 92);
    assert.equal(result.topics[0]?.state, "preselected");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("keeps an already 0-100 AI confidence unchanged", async () => {
  const previousFetch = globalThis.fetch;
  const previousProvider = process.env.AI_PROVIDER;
  const previousKey = process.env.OPENROUTER_API_KEY;

  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";

  const topic = mockTaxonomy.topics[0]!;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "A test resource summary.",
                concepts: [],
                keywords: [],
                subjectMatter: [],
                areas: [],
                topics: [
                  {
                    entityId: topic.id,
                    confidence: 82,
                    reason: "Strong semantic match."
                  }
                ],
                projects: [],
                suggestedAreas: [],
                suggestedTopics: [],
                suggestedSaveIntent: "learn",
                suggestedWhySaved: "It matches the topic well."
              })
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const result = await classifyResourceWithOpenAi(
      { type: "article", title: "Test Resource", description: "Test description." },
      mockTaxonomy
    );

    assert.equal(result.topics[0]?.confidence, 82);
    assert.equal(result.topics[0]?.state, "suggested");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

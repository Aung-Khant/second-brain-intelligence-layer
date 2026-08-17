import test from "node:test";
import assert from "node:assert/strict";
import { readAiConfig, shouldUseAi } from "../backend/src/config/ai.js";

test("reads OpenRouter AI config when selected", () => {
  const previous = snapshotEnv();
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

  try {
    assert.deepEqual(readAiConfig(), {
      provider: "openrouter",
      apiKey: "test-openrouter-key",
      model: "deepseek/deepseek-v4-flash"
    });
    assert.equal(shouldUseAi(), true);
  } finally {
    restoreEnv(previous);
  }
});

test("falls back to OpenAI config by default", () => {
  const previous = snapshotEnv();
  delete process.env.AI_PROVIDER;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_MODEL = "gpt-5-mini";

  try {
    assert.deepEqual(readAiConfig(), {
      provider: "openai",
      apiKey: "test-openai-key",
      model: "gpt-5-mini"
    });
    assert.equal(shouldUseAi(), true);
  } finally {
    restoreEnv(previous);
  }
});

function snapshotEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function restoreEnv(previous: NodeJS.ProcessEnv): void {
  process.env = previous;
}

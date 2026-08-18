// Reads which AI provider/model/key to use from env vars (AI_PROVIDER,
// OPENAI_*/OPENROUTER_*). shouldUseAi() is how the server decides whether
// "Improve" can actually call out, or must go straight to the local
// fallback - it's just "is an API key present."
export type AiProvider = "openai" | "openrouter";

export type AiConfig = {
  provider: AiProvider;
  apiKey?: string;
  model: string;
};

export function readAiConfig(): AiConfig {
  const provider = normalizeProvider(process.env.AI_PROVIDER);

  if (provider === "openrouter") {
    return {
      provider,
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash"
    };
  }

  return {
    provider,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5-mini"
  };
}

export function shouldUseAi(): boolean {
  return Boolean(readAiConfig().apiKey);
}

function normalizeProvider(value: string | undefined): AiProvider {
  return value === "openrouter" ? "openrouter" : "openai";
}

export type OpenAiConfig = {
  apiKey?: string;
  model: string;
};

export function readOpenAiConfig(): OpenAiConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5-mini"
  };
}

export function shouldUseOpenAi(): boolean {
  return Boolean(readOpenAiConfig().apiKey);
}

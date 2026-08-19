// One JSON-schema-constrained model call, shared by both AI passes. Split out
// so understand.ts and classify.ts only write prompts and schemas, never HTTP.
//
// Two behaviours here are carried over from production failures in the legacy
// classifier - do not "simplify" them away:
// - maxOutputTokens defaults to 2000. At 800 a response with several relations
//   (each carrying its own reason sentence) gets truncated mid-string and dies
//   with "Unterminated string in JSON".
// - The caller normalizes confidence, because some models answer with a 0-1
//   probability regardless of what the schema says. See toConfidence.
import { AppError } from "../../../shared/types/errors.js";
import { readAiConfig, type AiConfig } from "../config/ai.js";

type ResponsesApiOutput = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

type ChatCompletionsOutput = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type JsonModelRequest = {
  schemaName: string;
  schema: Record<string, unknown>;
  prompt: string;
  maxOutputTokens?: number;
};

export async function requestJson<T>(request: JsonModelRequest): Promise<T> {
  const config = readAiConfig();
  if (!config.apiKey) {
    throw new AppError(
      "AI_REQUEST_FAILED",
      `${config.provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} is required to analyze a resource.`
    );
  }

  // Even under a strict JSON schema, models occasionally emit invalid JSON -
  // typically an unescaped quote or a raw newline inside a string. It's
  // stochastic, so the same request usually succeeds on a second attempt.
  // Retrying here is far cheaper than failing the whole analyze.
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw =
      config.provider === "openrouter"
        ? await callOpenRouter(config, request)
        : await callOpenAiResponses(config, request);

    try {
      return parseJson<T>(raw, request.schemaName);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function callOpenAiResponses(config: AiConfig, request: JsonModelRequest): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      max_output_tokens: request.maxOutputTokens ?? 2000,
      input: request.prompt,
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      "AI_REQUEST_FAILED",
      `OpenAI request failed with HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as ResponsesApiOutput;
  const text =
    payload.output_text ??
    payload.output?.flatMap((item) => item.content ?? []).find((item) => item.text)?.text;

  if (!text) {
    throw new AppError("AI_INVALID_OUTPUT", "The model returned an empty response.");
  }

  return text;
}

async function callOpenRouter(config: AiConfig, request: JsonModelRequest): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:3737",
      "X-Title": "Second Brain Intelligence Layer"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: request.prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: request.schema
        }
      },
      provider: { require_parameters: true },
      max_tokens: request.maxOutputTokens ?? 2000,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      "AI_REQUEST_FAILED",
      `OpenRouter request failed with HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as ChatCompletionsOutput;
  const text = payload.choices?.[0]?.message?.content;

  if (!text) {
    throw new AppError("AI_INVALID_OUTPUT", "The model returned an empty response.");
  }

  return text;
}

function parseJson<T>(raw: string, schemaName: string): T {
  for (const candidate of [raw, stripCodeFence(raw), extractOutermostObject(raw)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next repair strategy.
    }
  }

  // Include what the model actually said. Without it, a malformed response is
  // undebuggable - the position in a JSON error means nothing on its own.
  throw new AppError(
    "AI_INVALID_OUTPUT",
    `The model returned invalid JSON for ${schemaName}. Raw output: ${raw.slice(0, 300)}`
  );
}

// Some models wrap JSON in a markdown fence despite being asked for raw JSON.
function stripCodeFence(raw: string): string | undefined {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1];
}

// Salvages the object when the model adds prose before or after it.
function extractOutermostObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : undefined;
}

// Some models return a 0-1 probability, some return 0-100, regardless of what
// the schema asks for. This pipeline's contract is 0-1, so anything above 1 is
// treated as a percentage and scaled back down.
export function toConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  const scaled = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, scaled));
}

export function toCleanString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function toStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

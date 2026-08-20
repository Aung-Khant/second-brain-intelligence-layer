// Bare-bones HTTP server (no framework) that the Chrome extension calls at
// http://127.0.0.1:3737. handleApiRequest is the pure routing/dispatch logic
// (method + pathname -> api.ts handler), kept separate from createDevServer/
// routeHttpRequest's Node http.Server plumbing so it's directly unit-
// testable without spinning up a real server - see tests/server.test.ts.
import http from "node:http";
import { AppError } from "../../../shared/types/errors.js";
import {
  classifyWithNotionTaxonomy,
  createApprovedArea,
  createApprovedTopic,
  createApprovedProject,
  enhanceClassificationWithAi,
  readTaxonomyForPicker,
  saveConfirmedResource,
  type ClassifyApiRequest,
  type CreateAreaApiRequest,
  type CreateTopicApiRequest,
  type CreateProjectApiRequest,
  type SaveApiRequest
} from "./api.js";
import { readNotionTaxonomyCacheStatus } from "../notion/taxonomy.js";
import {
  analyzeResource,
  saveAnalyzedResource,
  type AnalyzeRequest,
  type SaveRequest
} from "../v1/api.js";
import { createTaxonomyEntity, type CreateEntityInput } from "../v1/create-entity.js";
import { bearerToken, handleAuthRoute, resolveNotionConfig } from "./auth-routes.js";
import { completeAuthorization } from "../auth/notion-oauth.js";
import { renderCallbackPage } from "./callback-page.js";
import { renderSetupPage } from "./setup-page.js";

type JsonResponse = {
  statusCode: number;
  body: unknown;
};

const defaultPort = 3737;

export function createDevServer(): http.Server {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    // Notion redirects a real browser here, so this one route answers with a
    // page rather than JSON. It is also the only place that ever sees an
    // authorization code.
    if (url.pathname === "/api/auth/notion/callback") {
      const html = await renderCallbackPage(url.searchParams, completeAuthorization);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    if (url.pathname === "/setup") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderSetupPage());
      return;
    }

    const result = await routeHttpRequest(request);
    writeJson(response, result.statusCode, result.body);
  });
}

export async function handleApiRequest(
  method: string,
  pathname: string,
  body: unknown = {},
  context: { sessionToken?: string; query?: URLSearchParams } = {}
): Promise<JsonResponse> {
  if (method === "OPTIONS") {
    return { statusCode: 204, body: null };
  }

  const query = context.query ?? new URLSearchParams();
  const sessionToken = context.sessionToken;

  try {
    const authRoute = await handleAuthRoute(
      method,
      pathname,
      query,
      (body ?? {}) as Record<string, unknown>,
      sessionToken
    );
    if (authRoute) return authRoute;
    if (method === "GET" && pathname === "/health") {
      return {
        statusCode: 200,
        body: {
          ok: true,
          service: "second-brain-intelligence-layer",
          notionTaxonomyCache: readNotionTaxonomyCacheStatus()
        }
      };
    }

    if (method === "POST" && pathname === "/api/resource/analyze") {
      return {
        statusCode: 200,
        body: await analyzeResource(body as AnalyzeRequest, await resolveNotionConfig(sessionToken))
      };
    }

    if (method === "POST" && pathname === "/api/resource/save") {
      return {
        statusCode: 200,
        body: await saveAnalyzedResource(
          body as SaveRequest,
          await resolveNotionConfig(sessionToken)
        )
      };
    }

    if (method === "POST" && pathname === "/api/taxonomy/create") {
      return {
        statusCode: 200,
        body: await createTaxonomyEntity(
          body as CreateEntityInput,
          await resolveNotionConfig(sessionToken)
        )
      };
    }

    if (method === "POST" && pathname === "/api/classify") {
      return {
        statusCode: 200,
        body: await classifyWithNotionTaxonomy(body as ClassifyApiRequest)
      };
    }

    if (method === "POST" && pathname === "/api/enhance") {
      return {
        statusCode: 200,
        body: await enhanceClassificationWithAi(body as ClassifyApiRequest)
      };
    }

    if (method === "GET" && pathname === "/api/taxonomy") {
      return {
        statusCode: 200,
        body: await readTaxonomyForPicker()
      };
    }

    if (method === "POST" && pathname === "/api/save") {
      return {
        statusCode: 200,
        body: await saveConfirmedResource(body as SaveApiRequest)
      };
    }

    if (method === "POST" && pathname === "/api/topics") {
      return {
        statusCode: 200,
        body: await createApprovedTopic(body as CreateTopicApiRequest)
      };
    }

    if (method === "POST" && pathname === "/api/areas") {
      return {
        statusCode: 200,
        body: await createApprovedArea(body as CreateAreaApiRequest)
      };
    }

    if (method === "POST" && pathname === "/api/projects") {
      return {
        statusCode: 200,
        body: await createApprovedProject(body as CreateProjectApiRequest)
      };
    }

    return {
      statusCode: 404,
      body: {
        error: {
          code: "NOT_FOUND",
          message: "Route not found."
        }
      }
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function routeHttpRequest(request: http.IncomingMessage): Promise<JsonResponse> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const body = request.method === "POST" ? await readJsonBody(request) : {};

  return handleApiRequest(request.method ?? "GET", url.pathname, body, {
    sessionToken: bearerToken(request.headers as Record<string, string | undefined>),
    query: url.searchParams
  });
}

function toErrorResponse(error: unknown): JsonResponse {
  if (error instanceof AppError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: error.code,
          message: formatAppErrorMessage(error)
        }
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unexpected server error."
      }
    }
  };
}

function formatAppErrorMessage(error: AppError): string {
  const detail = getErrorDetail(error.cause);
  return detail ? `${error.message} ${detail}` : error.message;
}

function getErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message) return error.message;
  return getErrorDetail(error.cause);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};

  return JSON.parse(body);
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    // Authorization carries the session token; without it here the browser
    // blocks every authenticated call at the preflight.
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  });

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

export function startDevServer(port = readPort()): http.Server {
  const server = createDevServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Second Brain API listening on http://127.0.0.1:${port}\n`);
  });
  return server;
}

function readPort(): number {
  const value = process.env.SECOND_BRAIN_API_PORT;
  if (!value) return defaultPort;

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultPort;
}

import http from "node:http";
import { AppError } from "../../../shared/types/errors.js";
import {
  classifyWithNotionTaxonomy,
  createApprovedTopic,
  enhanceClassificationWithAi,
  readTaxonomyForPicker,
  saveConfirmedResource,
  type ClassifyApiRequest,
  type CreateTopicApiRequest,
  type SaveApiRequest
} from "./api.js";
import { readNotionTaxonomyCacheStatus } from "../notion/taxonomy.js";

type JsonResponse = {
  statusCode: number;
  body: unknown;
};

const defaultPort = 3737;

export function createDevServer(): http.Server {
  return http.createServer(async (request, response) => {
    const result = await routeHttpRequest(request);
    writeJson(response, result.statusCode, result.body);
  });
}

export async function handleApiRequest(
  method: string,
  pathname: string,
  body: unknown = {}
): Promise<JsonResponse> {
  if (method === "OPTIONS") {
    return { statusCode: 204, body: null };
  }

  try {
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
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  const body = request.method === "POST" ? await readJsonBody(request) : {};
  return handleApiRequest(request.method ?? "GET", pathname, body);
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
    "Access-Control-Allow-Headers": "Content-Type",
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

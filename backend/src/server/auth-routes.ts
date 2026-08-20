// HTTP surface for connecting a Notion workspace, and for turning a request's
// session header into the config the v1 pipeline needs.
//
// resolveNotionConfig is the security boundary of the whole multi-user change:
// every request that touches Notion goes through it, and it can only ever
// return the workspace belonging to the presented session. There is no path
// from a request to "the" workspace any more.
import { AppError } from "../../../shared/types/errors.js";
import {
  accessTokenFor,
  connectionForSession,
  deleteConnectionAndData,
  deleteSession,
  setDataSourceRoles,
  type DataSourceRoles
} from "../auth/connections.js";
import { deleteCorrectionsForConnection } from "../v1/corrections.js";
import { clearNotionTaxonomyCache } from "../notion/taxonomy.js";
import { discoverDataSources } from "../auth/discover.js";
import {
  claimAuthorization,
  isAuthorizationPending,
  isOAuthConfigured,
  startAuthorization
} from "../auth/notion-oauth.js";
import {
  configForConnection,
  localEnvFallbackEnabled,
  notionVersion,
  readNotionTaxonomyConfig,
  type NotionTaxonomyConfig
} from "../notion/config.js";

export function bearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : undefined;
}

export async function resolveNotionConfig(
  sessionToken: string | undefined
): Promise<NotionTaxonomyConfig> {
  const connection = await connectionForSession(sessionToken);
  if (connection) {
    return configForConnection(connection);
  }

  // Single-user development fallback. Only reachable when no session was
  // presented at all AND the owner explicitly opted in via
  // ALLOW_LOCAL_ENV_FALLBACK - otherwise an anonymous request on a shared
  // server would be served the owner's workspace.
  if (!sessionToken && localEnvFallbackEnabled()) {
    return readNotionTaxonomyConfig();
  }

  throw new AppError(
    "NOTION_AUTH_FAILED",
    sessionToken
      ? "Your Notion connection has expired. Connect Notion again."
      : "Connect your Notion workspace to start saving."
  );
}

export type AuthRoute = { statusCode: number; body: unknown } | undefined;

export async function handleAuthRoute(
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  sessionToken: string | undefined
): Promise<AuthRoute> {
  // What the popup asks on open, to decide whether to show the connect button.
  if (method === "GET" && pathname === "/api/auth/status") {
    const connection = await connectionForSession(sessionToken);
    return {
      statusCode: 200,
      body: {
        connected: Boolean(connection),
        oauthAvailable: isOAuthConfigured(),
        localFallback: !sessionToken && localEnvFallbackEnabled(),
        workspaceName: connection?.workspaceName ?? null,
        needsDatabaseSetup: Boolean(connection && !connection.roles)
      }
    };
  }

  if (method === "POST" && pathname === "/api/auth/notion/start") {
    return { statusCode: 200, body: startAuthorization() };
  }

  // Polled by the extension while the user is in the Notion tab. Returns the
  // session exactly once, then the pending record is gone.
  if (method === "GET" && pathname === "/api/auth/notion/claim") {
    const state = query.get("state") ?? "";
    const claimed = claimAuthorization(state);

    if (claimed) {
      return {
        statusCode: 200,
        body: {
          status: "connected",
          sessionToken: claimed.sessionToken,
          workspaceName: claimed.connection.workspaceName,
          needsDatabaseSetup: !claimed.connection.roles
        }
      };
    }

    return {
      statusCode: 200,
      body: { status: isAuthorizationPending(state) ? "pending" : "expired" }
    };
  }

  // Candidate databases for the picker, plus a guess at which is which.
  if (method === "GET" && pathname === "/api/auth/notion/databases") {
    const connection = await connectionForSession(sessionToken);
    if (!connection) {
      throw new AppError("NOTION_AUTH_FAILED", "Connect your Notion workspace first.");
    }

    const token = await accessTokenFor(connection.id);
    const discovery = await discoverDataSources(token, notionVersion());

    return {
      statusCode: 200,
      body: { ...discovery, current: connection.roles ?? null }
    };
  }

  if (method === "POST" && pathname === "/api/auth/notion/databases") {
    const connection = await connectionForSession(sessionToken);
    if (!connection) {
      throw new AppError("NOTION_AUTH_FAILED", "Connect your Notion workspace first.");
    }

    const roles = readRoles(body);
    const updated = await setDataSourceRoles(connection.id, roles);

    return {
      statusCode: 200,
      body: { ok: true, workspaceName: updated.workspaceName }
    };
  }

  // Disconnect means gone, not just logged out: the token, the database
  // mapping, and every correction record this connection produced are all
  // deleted here, not archived. If the person reconnects later they start
  // from a blank slate, which is the honest version of "disconnect".
  if (method === "POST" && pathname === "/api/auth/disconnect") {
    const connection = await connectionForSession(sessionToken);

    if (connection) {
      await deleteCorrectionsForConnection(connection.id);
      clearNotionTaxonomyCache(connection.id);
      await deleteConnectionAndData(connection.id);
    } else if (sessionToken) {
      await deleteSession(sessionToken);
    }

    return { statusCode: 200, body: { ok: true } };
  }

  return undefined;
}

function readRoles(body: Record<string, unknown>): DataSourceRoles {
  const roles: Partial<DataSourceRoles> = {};

  for (const key of [
    "areasDataSourceId",
    "projectsDataSourceId",
    "topicsDataSourceId",
    "resourcesDataSourceId"
  ] as const) {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError("PAGE_EXTRACTION_FAILED", `Choose a database for ${label(key)}.`);
    }
    roles[key] = value.trim();
  }

  return roles as DataSourceRoles;
}

function label(key: keyof DataSourceRoles): string {
  return {
    areasDataSourceId: "Areas",
    projectsDataSourceId: "Projects",
    topicsDataSourceId: "Topics",
    resourcesDataSourceId: "Resources"
  }[key];
}

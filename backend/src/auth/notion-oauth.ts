// The Notion OAuth handshake, plus the pending-authorization table that lets
// the extension pick up its session without the browser tab talking to it.
//
// Flow, and why it is shaped this way:
//   1. The extension asks for an authorize URL. The backend mints `state` and
//      remembers it. `state` is what ties a browser tab it will never see back
//      to the extension that started the flow.
//   2. The user approves in Notion and chooses which pages to share. Notion
//      redirects to the callback with a code.
//   3. The backend exchanges the code for a token server-side, using the
//      client secret. The secret and the resulting token never reach the
//      browser at all.
//   4. The extension polls with its `state` and collects the session token
//      once. Claiming consumes the pending record, so a leaked `state` is
//      useless after the first claim and expires regardless.
import { AppError } from "../../../shared/types/errors.js";
import { createConnection, type NotionConnection } from "./connections.js";
import { newOpaqueToken } from "./crypto.js";

const pendingTtlMs = 10 * 60 * 1000;

type PendingAuthorization = {
  createdAt: number;
  result?: { sessionToken: string; connection: NotionConnection };
};

const pending = new Map<string, PendingAuthorization>();

export type NotionOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function readNotionOAuthConfig(): NotionOAuthConfig {
  return {
    clientId: requireEnv("NOTION_OAUTH_CLIENT_ID"),
    clientSecret: requireEnv("NOTION_OAUTH_CLIENT_SECRET"),
    // Must match a redirect URI registered on the Notion integration exactly.
    redirectUri:
      process.env.NOTION_OAUTH_REDIRECT_URI?.trim() ||
      "http://127.0.0.1:3737/api/auth/notion/callback"
  };
}

export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.NOTION_OAUTH_CLIENT_ID?.trim() && process.env.NOTION_OAUTH_CLIENT_SECRET?.trim()
  );
}

export function startAuthorization(): { authorizeUrl: string; state: string } {
  const config = readNotionOAuthConfig();
  const state = newOpaqueToken();

  sweepExpired();
  pending.set(state, { createdAt: Date.now() });

  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);

  return { authorizeUrl: url.toString(), state };
}

export async function completeAuthorization(
  code: string,
  state: string
): Promise<NotionConnection> {
  sweepExpired();

  const record = pending.get(state);
  if (!record) {
    // An unknown state is either an expired attempt or a forged callback.
    // Neither should be exchanged for a token.
    throw new AppError(
      "NOTION_AUTH_FAILED",
      "This sign-in link has expired. Start connecting Notion again."
    );
  }

  const config = readNotionOAuthConfig();
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": process.env.NOTION_VERSION || "2026-03-11"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri
    })
  });

  const body = (await response.json()) as {
    access_token?: string;
    workspace_id?: string;
    workspace_name?: string;
    bot_id?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new AppError(
      "NOTION_AUTH_FAILED",
      `Notion rejected the sign-in: ${body.error_description || body.error || response.status}`
    );
  }

  const { connection, sessionToken } = await createConnection({
    accessToken: body.access_token,
    workspaceId: body.workspace_id ?? "",
    workspaceName: body.workspace_name ?? "Notion workspace",
    botId: body.bot_id ?? body.workspace_id ?? newOpaqueToken()
  });

  pending.set(state, { createdAt: record.createdAt, result: { sessionToken, connection } });

  return connection;
}

// One-shot: claiming consumes the pending record.
export function claimAuthorization(
  state: string
): { sessionToken: string; connection: NotionConnection } | undefined {
  sweepExpired();

  const record = pending.get(state);
  if (!record?.result) return undefined;

  pending.delete(state);
  return record.result;
}

export function isAuthorizationPending(state: string): boolean {
  sweepExpired();
  return pending.has(state);
}

function sweepExpired(): void {
  const cutoff = Date.now() - pendingTtlMs;
  for (const [state, record] of pending) {
    if (record.createdAt < cutoff) pending.delete(state);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "NOTION_AUTH_FAILED",
      `${name} is required for Notion sign-in. Create a public integration at notion.so/my-integrations.`
    );
  }
  return value;
}

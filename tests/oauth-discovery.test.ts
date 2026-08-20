// Covers the point of pointing people at a template: when the four databases
// can be matched by name with no ambiguity, setup should require zero manual
// steps from the person connecting.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeAuthorization, startAuthorization } from "../backend/src/auth/notion-oauth.js";
import { resetConnectionCacheForTests } from "../backend/src/auth/connections.js";

function dataSource(id: string, title: string) {
  return { id, object: "data_source", title: [{ plain_text: title }] };
}

async function withEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), "sbil-oauth-"));

  process.env.CONNECTIONS_STORE_PATH = join(directory, "connections.json");
  process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
  process.env.NOTION_OAUTH_CLIENT_ID = "client-id";
  process.env.NOTION_OAUTH_CLIENT_SECRET = "client-secret";
  process.env.NOTION_OAUTH_REDIRECT_URI = "http://127.0.0.1:3737/api/auth/notion/callback";
  resetConnectionCacheForTests();

  try {
    return await run();
  } finally {
    process.env = previous;
    resetConnectionCacheForTests();
    await rm(directory, { recursive: true, force: true });
  }
}

test("auto-applies database roles when names match with no ambiguity", async () => {
  await withEnv(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);

      if (url.includes("/v1/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "token-from-notion",
            workspace_id: "ws-1",
            workspace_name: "Friend's Second Brain",
            bot_id: "bot-1"
          }),
          { status: 200 }
        );
      }

      if (url.includes("/v1/search")) {
        return new Response(
          JSON.stringify({
            results: [
              dataSource("areas-id", "Areas"),
              dataSource("projects-id", "Projects"),
              dataSource("topics-id", "Topics"),
              dataSource("resources-id", "Resources")
            ],
            has_more: false
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    try {
      const { state } = startAuthorization();
      const connection = await completeAuthorization("auth-code", state);

      assert.equal(connection.workspaceName, "Friend's Second Brain");
      assert.deepEqual(connection.roles, {
        areasDataSourceId: "areas-id",
        projectsDataSourceId: "projects-id",
        topicsDataSourceId: "topics-id",
        resourcesDataSourceId: "resources-id"
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

// A renamed or missing database must fall through to the manual picker rather
// than guess - a wrong auto-applied mapping would silently file everything
// into the wrong place with no indication anything was wrong.
test("leaves roles unset when the names cannot be matched with confidence", async () => {
  await withEnv(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);

      if (url.includes("/v1/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "token-from-notion",
            workspace_id: "ws-2",
            workspace_name: "Custom Workspace",
            bot_id: "bot-2"
          }),
          { status: 200 }
        );
      }

      if (url.includes("/v1/search")) {
        return new Response(
          JSON.stringify({
            results: [dataSource("areas-id", "Areas"), dataSource("random-id", "My Notes")],
            has_more: false
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    }) as typeof fetch;

    try {
      const { state } = startAuthorization();
      const connection = await completeAuthorization("auth-code", state);

      assert.equal(connection.roles, undefined);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

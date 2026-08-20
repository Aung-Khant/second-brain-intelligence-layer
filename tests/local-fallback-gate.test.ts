// Guards the fix for saves landing in the server owner's workspace: a server
// with the owner's NOTION_API_KEY set used to serve that workspace to ANY
// request that arrived without a session, so a friend who installed the
// extension and never connected saved straight into the owner's Notion. The
// env fallback now requires an explicit ALLOW_LOCAL_ENV_FALLBACK=true opt-in,
// and without it a sessionless request is told to connect, not silently
// redirected.
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { handleApiRequest } from "../backend/src/server/dev-server.js";
import { resetConnectionCacheForTests } from "../backend/src/auth/connections.js";

async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };

  // Point the store somewhere empty so these tests never read a real
  // connections file that happens to exist in the checkout.
  process.env.CONNECTIONS_STORE_PATH = join(
    tmpdir(),
    `sbil-fallback-${process.pid}-${Math.random().toString(36).slice(2)}.json`
  );
  Object.assign(process.env, env);
  resetConnectionCacheForTests();

  try {
    return await run();
  } finally {
    process.env = previous;
    resetConnectionCacheForTests();
  }
}

const ownerEnv = {
  NOTION_API_KEY: "owners-secret-key",
  NOTION_AREAS_DATA_SOURCE_ID: "areas-ds",
  NOTION_TOPICS_DATA_SOURCE_ID: "topics-ds",
  NOTION_PROJECTS_DATA_SOURCE_ID: "projects-ds",
  NOTION_RESOURCES_DATA_SOURCE_ID: "resources-ds"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("a sessionless request is NOT given the owner's workspace by default", async () => {
  await withEnv({ ...ownerEnv, ALLOW_LOCAL_ENV_FALLBACK: "" }, async () => {
    const status = await handleApiRequest("GET", "/api/auth/status");
    assert.equal(isRecord(status.body) && status.body.localFallback, false);
    assert.equal(isRecord(status.body) && status.body.connected, false);

    // A save attempt without a session must fail closed, never write.
    const save = await handleApiRequest("POST", "/api/resource/save", {});
    assert.equal(save.statusCode, 400);
    assert.equal(
      isRecord(save.body) && isRecord(save.body.error) && save.body.error.code,
      "NOTION_AUTH_FAILED"
    );
  });
});

test("the owner can opt back into the sessionless env fallback explicitly", async () => {
  await withEnv({ ...ownerEnv, ALLOW_LOCAL_ENV_FALLBACK: "true" }, async () => {
    const status = await handleApiRequest("GET", "/api/auth/status");
    assert.equal(isRecord(status.body) && status.body.localFallback, true);
  });
});

// The opt-in only applies to requests with no session at all: presenting a
// session token - even a stale one - must never fall through to the owner's
// workspace.
test("a stale session never falls back to the owner's workspace", async () => {
  await withEnv({ ...ownerEnv, ALLOW_LOCAL_ENV_FALLBACK: "true" }, async () => {
    const save = await handleApiRequest(
      "POST",
      "/api/resource/save",
      {},
      { sessionToken: "session-that-no-longer-exists" }
    );

    assert.equal(save.statusCode, 400);
    assert.equal(
      isRecord(save.body) && isRecord(save.body.error) && save.body.error.code,
      "NOTION_AUTH_FAILED"
    );
  });
});

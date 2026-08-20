// Covers the guarantees multi-user rests on: tokens are unreadable at rest,
// sessions resolve only to their own workspace, and one person's databases are
// never reachable from another person's session.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  accessTokenFor,
  connectionForSession,
  createConnection,
  deleteConnectionAndData,
  deleteSession,
  resetConnectionCacheForTests,
  setDataSourceRoles
} from "../backend/src/auth/connections.js";
import { decryptSecret, encryptSecret } from "../backend/src/auth/crypto.js";

async function withStore<T>(run: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), "sbil-connections-"));

  process.env.CONNECTIONS_STORE_PATH = join(directory, "connections.json");
  process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  resetConnectionCacheForTests();

  try {
    return await run();
  } finally {
    process.env = previous;
    resetConnectionCacheForTests();
    await rm(directory, { recursive: true, force: true });
  }
}

const roles = {
  areasDataSourceId: "areas-1",
  projectsDataSourceId: "projects-1",
  topicsDataSourceId: "topics-1",
  resourcesDataSourceId: "resources-1"
};

test("round-trips an encrypted secret", async () => {
  await withStore(async () => {
    const encrypted = encryptSecret("ntn_secret_value");
    assert.notEqual(encrypted, "ntn_secret_value");
    assert.equal(decryptSecret(encrypted), "ntn_secret_value");
  });
});

// Authenticated encryption: a tampered payload must fail rather than decrypt
// to something that then gets sent to Notion as a bearer token.
test("refuses to decrypt a tampered secret", async () => {
  await withStore(async () => {
    const encrypted = encryptSecret("ntn_secret_value");
    const [iv, tag, ciphertext] = encrypted.split(".");
    const flipped = ciphertext.startsWith("A") ? `B${ciphertext.slice(1)}` : `A${ciphertext.slice(1)}`;

    assert.throws(() => decryptSecret([iv, tag, flipped].join(".")));
  });
});

test("never writes an access token to disk in plaintext", async () => {
  await withStore(async () => {
    await createConnection({
      accessToken: "ntn_super_secret",
      workspaceId: "ws-1",
      workspaceName: "Alice's brain",
      botId: "bot-1"
    });

    const onDisk = await readFile(process.env.CONNECTIONS_STORE_PATH as string, "utf8");
    assert.ok(!onDisk.includes("ntn_super_secret"), "token was written in plaintext");
  });
});

test("a session resolves only to its own workspace", async () => {
  await withStore(async () => {
    const alice = await createConnection({
      accessToken: "token-alice",
      workspaceId: "ws-alice",
      workspaceName: "Alice",
      botId: "bot-alice"
    });
    const bob = await createConnection({
      accessToken: "token-bob",
      workspaceId: "ws-bob",
      workspaceName: "Bob",
      botId: "bot-bob"
    });

    assert.equal((await connectionForSession(alice.sessionToken))?.workspaceName, "Alice");
    assert.equal((await connectionForSession(bob.sessionToken))?.workspaceName, "Bob");
    assert.notEqual(alice.connection.id, bob.connection.id);
    assert.equal(await accessTokenFor(alice.connection.id), "token-alice");
    assert.equal(await accessTokenFor(bob.connection.id), "token-bob");
  });
});

// The core isolation property: databases chosen by one person must not be
// reachable through anyone else's session.
test("keeps each connection's database mapping separate", async () => {
  await withStore(async () => {
    const alice = await createConnection({
      accessToken: "token-alice",
      workspaceId: "ws-alice",
      workspaceName: "Alice",
      botId: "bot-alice"
    });
    const bob = await createConnection({
      accessToken: "token-bob",
      workspaceId: "ws-bob",
      workspaceName: "Bob",
      botId: "bot-bob"
    });

    await setDataSourceRoles(alice.connection.id, roles);

    assert.equal((await connectionForSession(alice.sessionToken))?.roles?.areasDataSourceId, "areas-1");
    assert.equal((await connectionForSession(bob.sessionToken))?.roles, undefined);
  });
});

test("an unknown or deleted session resolves to nothing", async () => {
  await withStore(async () => {
    const alice = await createConnection({
      accessToken: "token-alice",
      workspaceId: "ws-alice",
      workspaceName: "Alice",
      botId: "bot-alice"
    });

    assert.equal(await connectionForSession("not-a-real-session"), undefined);
    assert.equal(await connectionForSession(undefined), undefined);

    await deleteSession(alice.sessionToken);
    assert.equal(await connectionForSession(alice.sessionToken), undefined);
  });
});

// Re-authorizing should not accumulate duplicate workspaces or lose the
// database mapping the user already chose.
test("re-authorizing the same workspace reuses it and keeps its databases", async () => {
  await withStore(async () => {
    const first = await createConnection({
      accessToken: "token-1",
      workspaceId: "ws-1",
      workspaceName: "Alice",
      botId: "bot-alice"
    });
    await setDataSourceRoles(first.connection.id, roles);

    const second = await createConnection({
      accessToken: "token-2",
      workspaceId: "ws-1",
      workspaceName: "Alice renamed",
      botId: "bot-alice"
    });

    assert.equal(second.connection.id, first.connection.id);
    assert.equal(second.connection.roles?.areasDataSourceId, "areas-1");
    assert.equal(await accessTokenFor(second.connection.id), "token-2");
    assert.notEqual(second.sessionToken, first.sessionToken);
  });
});

// The disconnect guarantee: gone means gone, not just logged out. A leftover
// token or an orphaned session that still resolves would quietly undermine
// "disconnect and delete my data".
test("deleting a connection removes the token and every session pointing at it", async () => {
  await withStore(async () => {
    const alice = await createConnection({
      accessToken: "token-alice",
      workspaceId: "ws-alice",
      workspaceName: "Alice",
      botId: "bot-alice"
    });
    const bob = await createConnection({
      accessToken: "token-bob",
      workspaceId: "ws-bob",
      workspaceName: "Bob",
      botId: "bot-bob"
    });

    await deleteConnectionAndData(alice.connection.id);

    assert.equal(await connectionForSession(alice.sessionToken), undefined);
    await assert.rejects(() => accessTokenFor(alice.connection.id));

    // Deleting one connection must not touch anyone else's.
    assert.equal((await connectionForSession(bob.sessionToken))?.workspaceName, "Bob");
    assert.equal(await accessTokenFor(bob.connection.id), "token-bob");
  });
});

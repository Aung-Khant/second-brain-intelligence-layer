// Per-user Notion connections and the sessions that address them.
//
// A "connection" is one authorized Notion workspace: the encrypted access
// token plus which data sources hold that workspace's Areas, Projects, Topics,
// and Resources. Those ids used to be global env vars, which is exactly what
// made the product single-user - one person's workspace was compiled into the
// server.
//
// A "session" is what the extension holds. It is an opaque random string that
// maps to a connection id and nothing else, so a compromised extension never
// exposes a Notion token, and revoking access is a single delete here.
//
// Storage is a JSON file behind this interface. It is enough for a
// self-hosted deployment and easy to reason about; swapping it for a real
// database means reimplementing this file and nothing else.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AppError } from "../../../shared/types/errors.js";
import { decryptSecret, encryptSecret, newOpaqueToken } from "./crypto.js";

export type DataSourceRoles = {
  areasDataSourceId: string;
  projectsDataSourceId: string;
  topicsDataSourceId: string;
  resourcesDataSourceId: string;
};

export type NotionConnection = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  botId: string;
  createdAt: string;
  // Absent until the user has told us which databases are which.
  roles?: DataSourceRoles;
};

type StoredConnection = NotionConnection & {
  encryptedAccessToken: string;
};

type StoreShape = {
  version: 1;
  connections: Record<string, StoredConnection>;
  // sessionToken -> connectionId
  sessions: Record<string, string>;
};

const emptyStore: StoreShape = { version: 1, connections: {}, sessions: {} };

let cache: StoreShape | undefined;

function storePath(): string {
  return resolve(process.env.CONNECTIONS_STORE_PATH || "data/connections.json");
}

async function load(): Promise<StoreShape> {
  if (cache) return cache;

  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as StoreShape;
    cache = { ...emptyStore, ...parsed };
  } catch {
    // A missing store is the normal first-run state, not an error.
    cache = structuredClone(emptyStore);
  }

  return cache;
}

// Written via a temp file and renamed so a crash mid-write cannot leave a
// half-written store that loses every connection.
async function persist(store: StoreShape): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temporaryPath, path);
  cache = store;
}

export async function createConnection(input: {
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
  botId: string;
}): Promise<{ connection: NotionConnection; sessionToken: string }> {
  const store = await load();

  // Re-authorizing the same workspace updates it in place rather than
  // accumulating duplicates, and keeps the database mapping already chosen.
  const existing = Object.values(store.connections).find(
    (candidate) => candidate.botId === input.botId
  );

  const id = existing?.id ?? newOpaqueToken();
  const connection: StoredConnection = {
    id,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    botId: input.botId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    roles: existing?.roles,
    encryptedAccessToken: encryptSecret(input.accessToken)
  };

  const sessionToken = newOpaqueToken();
  store.connections[id] = connection;
  store.sessions[sessionToken] = id;
  await persist(store);

  return { connection: publicView(connection), sessionToken };
}

export async function connectionForSession(
  sessionToken: string | undefined
): Promise<NotionConnection | undefined> {
  if (!sessionToken) return undefined;

  const store = await load();
  const connectionId = store.sessions[sessionToken];
  const connection = connectionId ? store.connections[connectionId] : undefined;

  return connection ? publicView(connection) : undefined;
}

export async function accessTokenFor(connectionId: string): Promise<string> {
  const store = await load();
  const connection = store.connections[connectionId];
  if (!connection) {
    throw new AppError("NOTION_AUTH_FAILED", "This Notion connection no longer exists.");
  }

  return decryptSecret(connection.encryptedAccessToken);
}

export async function setDataSourceRoles(
  connectionId: string,
  roles: DataSourceRoles
): Promise<NotionConnection> {
  const store = await load();
  const connection = store.connections[connectionId];
  if (!connection) {
    throw new AppError("NOTION_AUTH_FAILED", "This Notion connection no longer exists.");
  }

  connection.roles = roles;
  await persist(store);

  return publicView(connection);
}

export async function deleteSession(sessionToken: string): Promise<void> {
  const store = await load();
  delete store.sessions[sessionToken];
  await persist(store);
}

// Removes the connection itself - the encrypted token and every session
// pointing at it - not just one session. "Disconnect" is meant to mean leave
// no trace, and a friend using this for the first time should not have to
// know the difference between logging out and actually being forgotten.
export async function deleteConnectionAndData(connectionId: string): Promise<void> {
  const store = await load();

  delete store.connections[connectionId];
  for (const [sessionToken, mappedId] of Object.entries(store.sessions)) {
    if (mappedId === connectionId) delete store.sessions[sessionToken];
  }

  await persist(store);
}

// Never let the encrypted token escape this module, even in an object nobody
// currently serializes - the next person to add a debug log should not be able
// to leak it by accident.
function publicView(connection: StoredConnection): NotionConnection {
  const { encryptedAccessToken: _ignored, ...rest } = connection;
  return rest;
}

// Test seam: the store is cached in memory, so tests that write a fresh file
// need a way to forget it.
export function resetConnectionCacheForTests(): void {
  cache = undefined;
}

// Shared helper for the CLI scripts: reads JSON either from a file path
// given as the first CLI argument, or from stdin when no path is given
// (e.g. `cat fixture.json | npm run classify`).
import { readFile } from "node:fs/promises";

export async function readJsonArgumentOrStdin(): Promise<unknown> {
  const path = process.argv[2];
  const raw = path ? await readFile(path, "utf8") : await readStdin();
  return JSON.parse(raw) as unknown;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}


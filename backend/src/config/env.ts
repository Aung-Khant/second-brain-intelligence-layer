// Minimal hand-rolled .env loader (no dotenv dependency). Only sets a var if
// it isn't already present in process.env, so real environment variables
// always win over .env file values. Called once at the top of every CLI
// entry point before anything that needs NOTION_API_KEY/AI_* vars.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadDotEnv(path = ".env"): void {
  const fullPath = resolve(process.cwd(), path);
  if (!existsSync(fullPath)) return;

  for (const line of readFileSync(fullPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim().replace(/^export\s+/, "");
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unwrapEnvValue(rawValue);
  }
}

function unwrapEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

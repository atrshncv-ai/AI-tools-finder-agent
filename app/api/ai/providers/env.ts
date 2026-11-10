import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Environment lookup for the providers.
 *
 * The pipeline loop (`scripts/hermes/ralph-loop.sh`) sources `.env` once at
 * startup, so values it already holds stay frozen until a restart. Reading the
 * file again on every call lets `scripts/update-key.sh` take effect on the next
 * step without restarting the loop: a non-empty value from the file wins over
 * the value inherited from the process environment.
 */

export type EnvSource = Record<string, string | undefined>;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse KEY=VALUE lines; `export` prefixes, comments, blank lines and quotes are tolerated. */
export function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) continue;
    const name = withoutExport.slice(0, equals).trim();
    if (!ENV_NAME.test(name)) continue;
    let value = withoutExport.slice(equals + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

/** `<cwd>/.env` — the pipeline runs from `app/`. */
export function defaultEnvPath(): string {
  return resolve(process.cwd(), ".env");
}

/** Missing or unreadable file yields no overrides rather than an error. */
export function readEnvFile(path: string = defaultEnvPath()): Record<string, string> {
  try {
    return parseEnvText(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export type EnvLookupOptions = {
  /** Path to the env file; defaults to `<cwd>/.env`. */
  envPath?: string;
  /** Values to fall back to when the file has no non-empty value; defaults to `process.env`. */
  env?: EnvSource;
};

/** One snapshot for a whole provider call: process values overlaid by the env file. */
export function readProviderEnv(options: EnvLookupOptions = {}): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.env ?? process.env)) {
    if (typeof value === "string" && value.trim()) merged[name] = value.trim();
  }
  for (const [name, value] of Object.entries(readEnvFile(options.envPath))) {
    if (value.trim()) merged[name] = value.trim();
  }
  return merged;
}

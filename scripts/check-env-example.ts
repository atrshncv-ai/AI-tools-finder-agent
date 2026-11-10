#!/usr/bin/env tsx
/**
 * check-env-example.ts — the environment contract, checked in both directions.
 *
 * Code and `.env.example` drift apart quietly: a new variable is read in code
 * and nobody documents it, or the example keeps a name that no code reads any
 * more. A deployment then either misses a value or fills a dead one. This
 * script fails on either direction.
 *
 * Read side — names discovered in production code (`app/api`, `app/scripts/hermes`,
 * `app/db`, `app/src`):
 *   - `process.env.NAME` and `process.env["NAME"]`;
 *   - `env.NAME` / `values.NAME` lookups: the provider snapshot
 *     (`app/api/ai/providers/env.ts`) and `resolveRecipients` read the same
 *     variables without touching `process.env` directly;
 *   - keys of the zod env schema (`app/api/lib/env.ts`) — `PORT` and
 *     `CORS_ORIGIN` are validated there, never read as `process.env.X`.
 *
 * Declared side — keys of `app/.env.example`, the file `docs/DEPLOY.md` copies
 * to `app/.env`. A declared name that no code reads is not a defect by itself
 * (a shell script, docker-compose or the Node runtime may own it), but each one
 * needs an exemption below WITH a reason and, where applicable, the file that
 * consumes it. An undocumented leftover fails the check.
 *
 * Usage:
 *   cd app && npx tsx ../scripts/check-env-example.ts
 *   cd app && npx tsx ../scripts/check-env-example.ts --env-file /tmp/example.env
 *
 * Exit codes: 0 — contract holds, 1 — drift, 2 — usage or I/O error.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(REPO_ROOT, "app");
const DEFAULT_ENV_FILE = join(APP_DIR, ".env.example");
const ENV_SCHEMA_FILE = "api/lib/env.ts";

/** All application code the server runs; `scripts/*.ts` also holds manual helpers. */
const SCAN_ROOTS = ["api", "scripts", "db", "src"];
const SOURCE_FILE = /\.(ts|tsx)$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

/**
 * Files that are not part of the deployed system. Named one by one (never a
 * whole directory) and reported in the output, so adding another one is a
 * visible decision rather than a silent blind spot.
 */
const LEGACY_FILES = new Map<string, string>([
  ["app/scripts/test-cycle.ts", "legacy manual helper; the deployed pipeline never imports it"],
]);

/**
 * Declared names that no application code reads. `owner` is the file that
 * actually consumes the variable and is verified to exist, so an exemption
 * cannot outlive the thing it describes.
 */
type Exemption = { name: string; owner: string | null; reason: string };

const EXEMPTIONS: readonly Exemption[] = [
  {
    name: "POSTGRES_PASSWORD",
    owner: "docker-compose.yml",
    reason: "consumed by docker-compose (legacy container path); the app reads DATABASE_URL",
  },
  {
    name: "LINEAR_WORKER_INTERVAL_MS",
    owner: "app/scripts/hermes/ralph-loop.sh",
    reason: "consumed by the shell loop; it only paces retries and is not read by TypeScript",
  },
  {
    name: "NODE_EXTRA_CA_CERTS",
    owner: "scripts/deploy/gigachat-certs.sh",
    reason: "consumed by the Node runtime itself (extra trust anchors), not by application code",
  },
  {
    name: "BACKUP_S3_ENDPOINT",
    owner: "scripts/backup-offsite.sh",
    reason: "offsite storage endpoint, consumed by the backup script",
  },
  {
    name: "BACKUP_S3_BUCKET",
    owner: "scripts/backup-offsite.sh",
    reason: "offsite storage bucket, consumed by the backup script",
  },
  {
    name: "BACKUP_S3_REGION",
    owner: "scripts/backup-offsite.sh",
    reason: "optional S3 region, consumed by the backup script",
  },
  {
    name: "BACKUP_S3_PREFIX",
    owner: "scripts/backup-offsite.sh",
    reason: "key prefix inside the bucket, consumed by the backup script",
  },
  {
    name: "BACKUP_S3_ACCESS_KEY_ID",
    owner: "scripts/backup-offsite.sh",
    reason: "storage credential name; the value lives only in app/.env",
  },
  {
    name: "BACKUP_S3_SECRET_ACCESS_KEY",
    owner: "scripts/backup-offsite.sh",
    reason: "storage credential name; the value lives only in app/.env",
  },
  {
    name: "BACKUP_STATUS_FILE",
    owner: "scripts/backup-offsite.sh",
    reason: "where the last successful backup is recorded, consumed by the backup script",
  },
  {
    name: "APP_ID",
    owner: null,
    reason: "legacy Kimi platform OAuth; no code reads it, kept for an existing .env (docs/DEPLOY.md §13)",
  },
  {
    name: "KIMI_AUTH_URL",
    owner: null,
    reason: "legacy Kimi platform OAuth; no code reads it, kept for an existing .env (docs/DEPLOY.md §13)",
  },
  {
    name: "KIMI_OPEN_URL",
    owner: null,
    reason: "legacy Kimi platform OAuth; no code reads it, kept for an existing .env (docs/DEPLOY.md §13)",
  },
];

type Options = { envFile: string };

function parseArgs(argv: readonly string[]): Options {
  let envFile = DEFAULT_ENV_FILE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env-file") {
      const value = argv[++i];
      if (!value) throw new UsageError("--env-file needs a path");
      envFile = resolve(process.cwd(), value);
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  return { envFile };
}

class UsageError extends Error {}

function printUsage(): void {
  console.log(
    [
      "usage: check-env-example.ts [--env-file <path>]",
      "",
      "  --env-file  env example to check against (default: app/.env.example)",
      "",
      "Fails when code reads a variable the example does not declare, and when",
      "the example declares a variable no code reads without an exemption.",
    ].join("\n"),
  );
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (SKIPPED_DIRS.has(entry)) continue;
      files.push(...walk(full));
    } else if (SOURCE_FILE.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const PROCESS_ENV = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const PROCESS_ENV_BRACKET = /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;
const LOOKUP_ENV = /\b(?:env|values)\.([A-Z][A-Z0-9_]{2,})\b/g;
const ZOD_KEY = /^\s{2}([A-Z][A-Z0-9_]+):\s*z\./gm;

function collect(source: string, pattern: RegExp, into: Set<string>): void {
  for (const match of source.matchAll(pattern)) {
    into.add(match[1]);
  }
}

/** Variables the code actually reads, with the file that reads them. */
function readNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(APP_DIR, root))) {
      if (LEGACY_FILES.has(relative(REPO_ROOT, file))) continue;
      const source = readFileSync(file, "utf8");
      const found = new Set<string>();
      collect(source, PROCESS_ENV, found);
      collect(source, PROCESS_ENV_BRACKET, found);
      collect(source, LOOKUP_ENV, found);
      for (const name of found) {
        const rel = relative(REPO_ROOT, file);
        if (!names.has(name)) names.set(name, rel);
      }
    }
  }

  const schemaPath = join(APP_DIR, ENV_SCHEMA_FILE);
  if (!existsSync(schemaPath)) {
    throw new Error(`env schema not found: ${relative(REPO_ROOT, schemaPath)}`);
  }
  const schema = new Set<string>();
  collect(readFileSync(schemaPath, "utf8"), ZOD_KEY, schema);
  for (const name of schema) {
    if (!names.has(name)) names.set(name, relative(REPO_ROOT, schemaPath));
  }
  return names;
}

/** Keys of the env example, with the line number for a readable report. */
function readDeclared(envFile: string): Map<string, number> {
  const declared = new Map<string, number>();
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && !declared.has(match[1])) declared.set(match[1], i + 1);
  }
  return declared;
}

function main(): number {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check-env-example: ${error instanceof Error ? error.message : String(error)}`);
    printUsage();
    return 2;
  }

  if (!existsSync(options.envFile)) {
    console.error(`check-env-example: env example not found: ${options.envFile}`);
    return 2;
  }

  const read = readNames();
  const declared = readDeclared(options.envFile);
  const exemptions = new Map(EXEMPTIONS.map((item) => [item.name, item]));

  const missingInExample = [...read.keys()].filter((name) => !declared.has(name)).sort();
  const unreadDeclared = [...declared.keys()]
    .filter((name) => !read.has(name) && !exemptions.has(name))
    .sort();
  const deadExemptions = EXEMPTIONS.filter((item) => !declared.has(item.name)).map((item) => item.name);
  const brokenOwners = EXEMPTIONS.filter(
    (item) => item.owner !== null && !existsSync(join(REPO_ROOT, item.owner)),
  );
  const deadLegacy = [...LEGACY_FILES.keys()].filter((file) => !existsSync(join(REPO_ROOT, file)));

  const examplePath = relative(REPO_ROOT, options.envFile) || options.envFile;
  const legacyNote = LEGACY_FILES.size > 0 ? ` (skipped legacy: ${[...LEGACY_FILES.keys()].join(", ")})` : "";
  console.log(
    `check-env-example: ${read.size} variables read by code, ${declared.size} declared in ${examplePath}${legacyNote}`,
  );

  if (
    missingInExample.length === 0 &&
    unreadDeclared.length === 0 &&
    deadExemptions.length === 0 &&
    brokenOwners.length === 0 &&
    deadLegacy.length === 0
  ) {
    console.log(`check-env-example: OK (${exemptions.size} exemptions with a reason)`);
    return 0;
  }

  if (missingInExample.length > 0) {
    console.error(`\nRead by code, missing in ${examplePath}:`);
    for (const name of missingInExample) {
      console.error(`  - ${name}  (read in ${read.get(name)})`);
    }
  }
  if (unreadDeclared.length > 0) {
    console.error(`\nDeclared in ${examplePath}, read by no code and not exempt:`);
    for (const name of unreadDeclared) {
      console.error(`  - ${name}  (${examplePath}:${declared.get(name)})`);
    }
  }
  if (deadExemptions.length > 0) {
    console.error("\nExemptions for names the example no longer declares (remove the exemption):");
    for (const name of deadExemptions) console.error(`  - ${name}`);
  }
  if (brokenOwners.length > 0) {
    console.error("\nExemptions whose owning file does not exist:");
    for (const item of brokenOwners) console.error(`  - ${item.name} -> ${item.owner}`);
  }
  if (deadLegacy.length > 0) {
    console.error("\nLegacy-file exclusions for files that no longer exist (remove them):");
    for (const file of deadLegacy) console.error(`  - ${file}`);
  }
  console.error("\ncheck-env-example: FAIL — the env contract has drifted");
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`check-env-example: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}

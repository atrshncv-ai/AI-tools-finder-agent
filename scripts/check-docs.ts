#!/usr/bin/env tsx
/**
 * check-docs.ts — the documentation contract, checked against the code.
 *
 * Three things rot first and are checked here:
 *
 * 1. Facts that live in code and are quoted in prose: the score gate, the day
 *    budget, the default model ids, the number of sections and science
 *    directions, the judge threshold, digest limits. ARCHITECTURE.md keeps them
 *    in one table between the `checked-facts` markers; every value there is
 *    extracted from the source and compared, so a changed constant fails the
 *    check instead of shipping a document that lies.
 * 2. Paths: every `scripts/…`, `app/…` or `docs/…` path mentioned in the
 *    documents must exist in the repository (or be listed as created at
 *    runtime), so a runbook cannot point at a file that is not there.
 * 3. Shell syntax: every shell script in `scripts/` and `app/scripts/hermes/`
 *    must pass `bash -n`; a deploy script that does not parse is not a deploy
 *    script.
 *
 * Usage:
 *   cd app && npx tsx ../scripts/check-docs.ts
 *   cd app && npx tsx ../scripts/check-docs.ts --architecture /tmp/broken.md
 *
 * Exit codes: 0 — documents agree with code, 1 — drift, 2 — usage or I/O error.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(REPO_ROOT, "app");
const DEFAULT_ARCHITECTURE = join(REPO_ROOT, "ARCHITECTURE.md");
const FACTS_START = "<!-- checked-facts:start -->";
const FACTS_END = "<!-- checked-facts:end -->";

/** Files whose cross-references are verified. */
const DOC_FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "CONTEXT.md",
  "PROGRESS.md",
  "docs/DEPLOY.md",
  "app/skills/news-processor/SKILL.md",
];

/** Paths a document may name without them being in a fresh clone. */
const RUNTIME_PATHS = new Set([
  "app/.env",
  "app/dist",
  "app/dist/boot.js",
  "app/dist/public",
  "app/node_modules",
  "app/backups",
  "app/tmp",
]);

class UsageError extends Error {}

type Options = { architecture: string };

function parseArgs(argv: readonly string[]): Options {
  let architecture = DEFAULT_ARCHITECTURE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--architecture") {
      const value = argv[++i];
      if (!value) throw new UsageError("--architecture needs a path");
      architecture = resolve(process.cwd(), value);
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: check-docs.ts [--architecture <path>]");
      process.exit(0);
    } else {
      throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  return { architecture };
}

function read(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

function requireMatch(source: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`cannot read ${what} from the code — the extraction pattern is stale`);
  return match[1];
}

/** Entries of a `export const NAME ... = [ … ];` array, counted by their `id:`. */
function countIds(source: string, exportName: string): number {
  const start = source.indexOf(exportName);
  if (start < 0) throw new Error(`cannot find ${exportName} in topics.ts`);
  const end = source.indexOf("\n];", start);
  if (end < 0) throw new Error(`cannot find the end of ${exportName} in topics.ts`);
  return (source.slice(start, end).match(/\bid:\s*"/g) ?? []).length;
}

function stripCell(value: string): string {
  return value.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

/** Facts quoted in ARCHITECTURE.md and where the code keeps them. */
function codeFacts(): Map<string, string> {
  const pipelineConfig = read("app/scripts/hermes/pipeline-config.ts");
  const publishBudget = read("app/scripts/hermes/publish-budget.ts");
  const gigachat = read("app/api/ai/providers/gigachat.ts");
  const zenClient = read("app/api/ai/zenClient.ts");
  const zenProvider = read("app/api/ai/providers/zen.ts");
  const judge = read("app/scripts/hermes/judge.ts");
  const digest = read("app/scripts/hermes/digest-format.ts");
  const topics = read("app/scripts/hermes/topics.ts");

  const budgetMin = requireMatch(publishBudget, /DAILY_BUDGET_MIN = (\d+)/, "DAILY_BUDGET_MIN");
  const budgetMax = requireMatch(publishBudget, /DAILY_BUDGET_MAX = (\d+)/, "DAILY_BUDGET_MAX");
  const budgetDefault = requireMatch(publishBudget, /DAILY_BUDGET_DEFAULT = (\d+)/, "DAILY_BUDGET_DEFAULT");

  return new Map<string, string>([
    ["SCORE_GATE", requireMatch(pipelineConfig, /export const SCORE_GATE = (\d+)/, "SCORE_GATE")],
    ["DAILY_BUDGET", `${budgetMin}..${budgetMax}, default ${budgetDefault}`],
    [
      "GIGACHAT_MODEL",
      requireMatch(gigachat, /DEFAULT_GIGACHAT_MODEL = "([^"]+)"/, "DEFAULT_GIGACHAT_MODEL"),
    ],
    ["ZEN_GO_MODEL", requireMatch(zenClient, /ZEN_GO_MODEL_DEFAULT = "([^"]+)"/, "ZEN_GO_MODEL_DEFAULT")],
    ["ZEN_MODEL_LEGACY", requireMatch(zenProvider, /process\.env\.ZEN_MODEL \|\| "([^"]+)"/, "the legacy Zen model")],
    ["DIRECTIONS", String(countIds(topics, "export const DIRECTIONS"))],
    ["SECTIONS", String(countIds(topics, "export const SECTIONS"))],
    [
      "JUDGE_CONFIDENCE_THRESHOLD",
      requireMatch(judge, /export const JUDGE_CONFIDENCE_THRESHOLD = ([\d.]+)/, "JUDGE_CONFIDENCE_THRESHOLD"),
    ],
    [
      "MAX_ITEMS_PER_SECTION",
      requireMatch(digest, /export const MAX_ITEMS_PER_SECTION = (\d+)/, "MAX_ITEMS_PER_SECTION"),
    ],
    ["SUMMARY_MAX_CHARS", requireMatch(digest, /export const SUMMARY_MAX_CHARS = (\d+)/, "SUMMARY_MAX_CHARS")],
  ]);
}

/** Values from the checked-facts table in ARCHITECTURE.md. */
function documentFacts(architecturePath: string): Map<string, string> {
  const source = readFileSync(architecturePath, "utf8");
  const start = source.indexOf(FACTS_START);
  const end = source.indexOf(FACTS_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`checked-facts block not found in ${architecturePath}`);
  }
  const block = source.slice(start + FACTS_START.length, end);
  const facts = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line.trim());
    if (match) facts.set(match[1], stripCell(match[2]));
  }
  if (facts.size === 0) throw new Error("checked-facts block is empty");
  return facts;
}

function checkFacts(architecturePath: string): string[] {
  const expected = codeFacts();
  const documented = documentFacts(architecturePath);
  const problems: string[] = [];

  for (const [name, value] of expected) {
    const actual = documented.get(name);
    if (actual === undefined) problems.push(`missing row: \`${name}\` (code says ${value})`);
    else if (actual !== value) problems.push(`${name}: document says "${actual}", code says "${value}"`);
  }
  for (const name of documented.keys()) {
    if (!expected.has(name)) problems.push(`unknown row: \`${name}\` is not a checked fact`);
  }
  return problems;
}

function walkShell(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...walkShell(full));
    else if (entry.endsWith(".sh")) files.push(full);
  }
  return files;
}

function checkBashSyntax(): string[] {
  const scripts = [...walkShell(join(REPO_ROOT, "scripts")), ...walkShell(join(APP_DIR, "scripts"))];
  const problems: string[] = [];
  for (const script of scripts) {
    const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim().split("\n")[0];
      problems.push(`${relative(REPO_ROOT, script)}: bash -n failed — ${detail}`);
    }
  }
  return problems;
}

/**
 * `scripts/x`, `app/x`, `docs/x` mentions; `https://…/docs/x` is not a path.
 * Documents are read from two working directories — the repository root and
 * `app/` (pipeline commands in SKILL.md and docs/DEPLOY.md run from there), so a
 * candidate is valid when it exists under either one.
 */
const DOC_PATH =
  /(?<![\w./-])((?:app|scripts|docs)\/[A-Za-z0-9_][A-Za-z0-9_./-]*|ecosystem\.config\.cjs|docker-compose\.yml|Dockerfile|[A-Z][A-Z0-9_]*\.md)/g;

function trimCandidate(path: string): string {
  let candidate = path;
  while (candidate.length > 0 && /[./]$/.test(candidate)) candidate = candidate.slice(0, -1);
  return candidate;
}

function checkPaths(): string[] {
  const problems: string[] = [];
  for (const doc of DOC_FILES) {
    const full = resolve(REPO_ROOT, doc);
    if (!existsSync(full)) {
      problems.push(`${doc}: document is missing`);
      continue;
    }
    const source = readFileSync(full, "utf8");
    const seen = new Set<string>();
    for (const match of source.matchAll(DOC_PATH)) {
      const candidate = trimCandidate(match[1]);
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (RUNTIME_PATHS.has(candidate)) continue;
      if (existsSync(resolve(REPO_ROOT, candidate))) continue;
      if (existsSync(resolve(APP_DIR, candidate))) continue;
      problems.push(`${doc}: references ${candidate}, which is not in the repository`);
    }
  }
  return problems;
}

function main(): number {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check-docs: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (!existsSync(options.architecture)) {
    console.error(`check-docs: ${options.architecture} not found`);
    return 2;
  }

  const factsProblems = checkFacts(options.architecture);
  const pathProblems = checkPaths();
  const syntaxProblems = checkBashSyntax();

  console.log(`check-docs: facts ${factsProblems.length === 0 ? "OK" : "FAIL"}`);
  console.log(`check-docs: document paths ${pathProblems.length === 0 ? "OK" : "FAIL"}`);
  console.log(`check-docs: bash -n ${syntaxProblems.length === 0 ? "OK" : "FAIL"}`);

  const problems = [...factsProblems, ...pathProblems, ...syntaxProblems];
  if (problems.length === 0) {
    console.log("check-docs: OK — documents agree with the code");
    return 0;
  }

  console.error("\ncheck-docs: FAIL — the documents have drifted");
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`check-docs: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}

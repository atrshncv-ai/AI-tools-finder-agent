import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countTokens } from "../zenClient";
import { createZenProvider } from "./zen";

// Dummy keys only — never a real credential.
const GO_KEY_ONE = "go-dummy-key-one";
const GO_KEY_TWO = "go-dummy-key-two";
const LEGACY_KEY = "legacy-dummy-key";
const GO_BASE_URL = "https://go.test-opencode.local/v1";
const ZEN_BASE_URL = "https://zen.test-opencode.local/v1";
const SCRIPT_PATH = resolve(import.meta.dirname, "../../../../scripts/update-key.sh");

const ENV_KEYS = [
  "ZEN_GO_API_KEY",
  "ZEN_GO_API_KEYS",
  "ZEN_GO_BASE_URL",
  "ZEN_GO_MODEL",
  "ZEN_GO_SESSION_ID",
  "ZEN_API_KEY",
  "ZEN_API_KEYS",
  "ZEN_BASE_URL",
  "ZEN_MODEL",
  "ZEN_RETRIES",
  "ZEN_RETRY_DELAY_MS",
  "ZEN_TIMEOUT_MS",
  "ZEN_CONCURRENCY",
  "AGENT_UA",
];

type RecordedCall = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

const mockFetch = vi.fn();
const tempDirs: string[] = [];
let savedEnv: Record<string, string | undefined> = {};

function startFetchPlan(responses: string[]) {
  const queue = [...responses];
  const calls: RecordedCall[] = [];
  mockFetch.mockImplementation(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: String(init?.body ?? ""),
    });
    const content = queue.shift();
    if (content === undefined) throw new Error("unexpected extra OpenCode request");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-test",
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 999, completion_tokens: 999, total_tokens: 1998 },
      }),
    } as unknown as Response;
  });
  return calls;
}

function envFile(values: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "zen-env-"));
  tempDirs.push(dir);
  const path = join(dir, ".env");
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function goEnvFile(overrides: Record<string, string> = {}): string {
  return envFile({
    ZEN_GO_API_KEY: GO_KEY_ONE,
    ZEN_GO_BASE_URL: GO_BASE_URL,
    ZEN_GO_MODEL: "mimo-test",
    ZEN_RETRIES: "0",
    ...overrides,
  });
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createZenProvider", () => {
  it("delegates to the OpenCode client and reports provider, model and token spend", async () => {
    const calls = startFetchPlan(['{"onTopic": true}']);
    const provider = createZenProvider({ envPath: goEnvFile(), env: {} });
    const messages = [
      { role: "system" as const, content: "Верни JSON" },
      { role: "user" as const, content: "Текст вопроса" },
    ];

    const result = await provider.completeJson({ messages });

    expect(provider.id).toBe("opencode");
    expect(result.provider).toBe("opencode");
    expect(result.model).toBe("mimo-test");
    expect(result.text).toBe('{"onTopic": true}');
    expect(result.usage).toEqual({
      inputTokens: countTokens("Верни JSON") + countTokens("Текст вопроса"),
      outputTokens: countTokens('{"onTopic": true}'),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GO_BASE_URL}/chat/completions`);
    expect(calls[0].headers["Authorization"]).toBe(`Bearer ${GO_KEY_ONE}`);
    const body = JSON.parse(calls[0].body);
    expect(body.model).toBe("mimo-test");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Текст вопроса" });
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0.3);
  });

  it("keeps the answer body untouched so JSON stays parseable", async () => {
    const multiline = '{"first": 1}\n\n{"second": 2}';
    startFetchPlan([multiline]);
    const provider = createZenProvider({ envPath: goEnvFile(), env: {} });

    const result = await provider.completeJson({
      messages: [{ role: "user", content: "Верни два объекта" }],
      maxTokens: 200,
      temperature: 0,
    });

    expect(result.text).toBe(multiline);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0);
  });

  it("still serves the legacy Zen pool when no Go key is configured", async () => {
    const calls = startFetchPlan(["legacy answer"]);
    const provider = createZenProvider({
      envPath: envFile({
        ZEN_API_KEY: LEGACY_KEY,
        ZEN_BASE_URL,
        ZEN_MODEL: "legacy-test-model",
        ZEN_RETRIES: "0",
      }),
      env: {},
    });

    const result = await provider.completeJson({
      messages: [{ role: "user", content: "Текст" }],
    });

    expect(result.model).toBe("legacy-test-model");
    expect(calls[0].url).toBe(`${ZEN_BASE_URL}/chat/completions`);
    expect(calls[0].headers["Authorization"]).toBe(`Bearer ${LEGACY_KEY}`);
  });

  it("uses a key replaced by scripts/update-key.sh on the next call without a restart", async () => {
    const path = envFile({
      ZEN_GO_API_KEY: GO_KEY_ONE,
      ZEN_GO_BASE_URL: GO_BASE_URL,
      ZEN_GO_MODEL: "mimo-test",
      ZEN_RETRIES: "0",
      KEEP_ME: "keep",
    });
    const firstCalls = startFetchPlan(["first answer"]);
    const firstProvider = createZenProvider({ envPath: path, env: {} });
    await firstProvider.completeJson({ messages: [{ role: "user", content: "Текст" }] });
    expect(firstCalls[0].headers["Authorization"]).toBe(`Bearer ${GO_KEY_ONE}`);

    const stdout = execFileSync("bash", [SCRIPT_PATH, "ZEN_GO_API_KEY"], {
      input: `${GO_KEY_TWO}\n`,
      env: { ...process.env, ENV_FILE: path },
      encoding: "utf8",
    });

    expect(stdout).not.toContain(GO_KEY_TWO);
    expect(stdout).not.toContain("ZEN_GO_API_KEY");
    const envText = readFileSync(path, "utf8");
    expect(envText).toContain(`ZEN_GO_API_KEY=${GO_KEY_TWO}`);
    expect(envText).toContain("KEEP_ME=keep");

    // The next pipeline step is a fresh process: reload the module graph the
    // way a new `npx tsx` child would.
    vi.resetModules();
    mockFetch.mockReset();
    const secondCalls = startFetchPlan(["second answer"]);
    const secondProvider = createZenProvider({ envPath: path, env: {} });
    await secondProvider.completeJson({ messages: [{ role: "user", content: "Текст" }] });

    expect(secondCalls[0].headers["Authorization"]).toBe(`Bearer ${GO_KEY_TWO}`);
  });
});

type ScriptResult = { status: number | null; stdout: string; stderr: string };

function runUpdateKey(envPath: string, args: string[], input?: string): ScriptResult {
  const options: { env: NodeJS.ProcessEnv; encoding: "utf8"; input?: string } = {
    env: { ...process.env, ENV_FILE: envPath },
    encoding: "utf8",
  };
  if (input !== undefined) options.input = input;
  try {
    const stdout = execFileSync("bash", [SCRIPT_PATH, ...args], options);
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: typeof failure.status === "number" ? failure.status : null,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("scripts/update-key.sh", () => {
  it("refuses a value passed as an argument, where it would leak through history and ps", () => {
    const path = envFile({ ZEN_GO_API_KEY: GO_KEY_ONE });

    const result = runUpdateKey(path, ["ZEN_GO_API_KEY", GO_KEY_TWO]);

    expect(result.status).toBe(64);
    expect(`${result.stdout}${result.stderr}`).not.toContain(GO_KEY_TWO);
    expect(readFileSync(path, "utf8")).toContain(`ZEN_GO_API_KEY=${GO_KEY_ONE}`);
  });

  it("never echoes the first argument when it is not a valid variable name", () => {
    const path = envFile({ ZEN_GO_API_KEY: GO_KEY_ONE });

    const result = runUpdateKey(path, [GO_KEY_TWO]);

    expect(result.status).toBe(64);
    expect(`${result.stdout}${result.stderr}`).not.toContain(GO_KEY_TWO);
    expect(readFileSync(path, "utf8")).toContain(`ZEN_GO_API_KEY=${GO_KEY_ONE}`);
  });
});

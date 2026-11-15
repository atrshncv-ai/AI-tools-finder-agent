/**
 * youtube-transcript.test.ts — caption → local Whisper → HTTP API chain.
 *
 * yt-dlp, the Python process and the network are mocked: the suite proves the
 * ORDER and the wiring, never downloads a model and needs no API key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void;
type ExecResult = { stdout?: string; stderr?: string; error?: Error };
type ExecHandler = (command: string, args: string[]) => ExecResult;

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  existsSync: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  readdir: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: mocks.existsSync };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: mocks.readFile, unlink: mocks.unlink, readdir: mocks.readdir };
});

import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_TIMEOUT_MS,
  LOCAL_TRANSCRIBE_SCRIPT,
  VENV_PYTHON,
  isTranscribeLocalAvailable,
  resolvePython,
  transcribeLocal,
} from "./transcribe-local";
import { fetchYoutubeTranscript } from "./youtube-transcript";

const LONG_TRANSCRIPT =
  "A usable transcript sentence about artificial intelligence and science. ".repeat(4).trim();

const VIDEO = {
  id: "vid123",
  title: "AI video",
  description: "Video description",
  channel: "AI Channel",
  duration: 600,
  language: "en",
};

function execImpl(handler: ExecHandler): void {
  mocks.execFile.mockImplementation(
    (command: string, args: string[], _options: unknown, callback: ExecCallback) => {
      const result = handler(command, args);
      callback(result.error ?? null, result.stdout ?? "", result.stderr ?? "");
    },
  );
}

/** The venv and the Python script exist; everything else does not. */
function installLocal(): void {
  mocks.existsSync.mockImplementation(
    (path: string) => path === VENV_PYTHON || path === LOCAL_TRANSCRIBE_SCRIPT,
  );
}

function ytdlpInfo(info: unknown): ExecResult {
  return { stdout: JSON.stringify(info) };
}

/** HTTP Whisper API answers with a long transcript. */
function apiFetch(): void {
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => LONG_TRANSCRIPT,
  });
}

function commandNames(): string[] {
  return mocks.execFile.mock.calls.map(([command]) => String(command));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existsSync.mockReturnValue(false);
  mocks.readFile.mockResolvedValue(Buffer.from("fake audio"));
  mocks.unlink.mockResolvedValue(undefined);
  mocks.readdir.mockResolvedValue([]);
  mocks.fetch.mockRejectedValue(new Error("network is disabled in this suite"));
  vi.stubEnv("WHISPER_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("TRANSCRIBE_LOCAL_ENABLED", "");
  vi.stubEnv("TRANSCRIBE_LOCAL_MODEL", "");
  vi.stubEnv("TRANSCRIBE_LOCAL_TIMEOUT_MS", "");
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("transcribeLocal", () => {
  it("stays off by default when only the system python is present", async () => {
    mocks.existsSync.mockImplementation((path: string) => path === LOCAL_TRANSCRIBE_SCRIPT);

    expect(isTranscribeLocalAvailable()).toBe(false);
    expect(resolvePython()).toBe("python3");
    expect(await transcribeLocal("/tmp/audio.mp3")).toBeNull();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("runs the venv python with an explicit model and timeout", async () => {
    installLocal();
    execImpl(() => ({ stdout: "  hello from whisper \n" }));

    const text = await transcribeLocal("/tmp/audio.mp3", { model: "tiny", timeoutMs: 1234 });

    expect(text).toBe("hello from whisper");
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    const [command, args, options] = mocks.execFile.mock.calls[0];
    expect(command).toBe(VENV_PYTHON);
    expect(args).toEqual([LOCAL_TRANSCRIBE_SCRIPT, "--model", "tiny", "--", "/tmp/audio.mp3"]);
    expect(options).toMatchObject({ timeout: 1234 });
  });

  it("defaults to the small model and the long CPU timeout", async () => {
    installLocal();
    execImpl(() => ({ stdout: "text" }));

    expect(await transcribeLocal("/tmp/audio.mp3")).toBe("text");

    const [, args, options] = mocks.execFile.mock.calls[0];
    expect(args).toEqual([
      LOCAL_TRANSCRIBE_SCRIPT,
      "--model",
      DEFAULT_LOCAL_MODEL,
      "--",
      "/tmp/audio.mp3",
    ]);
    expect(options).toMatchObject({ timeout: DEFAULT_LOCAL_TIMEOUT_MS });
  });

  it("reads the model and timeout overrides from the environment", async () => {
    installLocal();
    vi.stubEnv("TRANSCRIBE_LOCAL_MODEL", "base");
    vi.stubEnv("TRANSCRIBE_LOCAL_TIMEOUT_MS", "45000");
    execImpl(() => ({ stdout: "text" }));

    expect(await transcribeLocal("/tmp/audio.mp3")).toBe("text");

    const [, args, options] = mocks.execFile.mock.calls[0];
    expect(args[2]).toBe("base");
    expect(options).toMatchObject({ timeout: 45000 });
  });

  it("can use system python when the venv is absent and the feature is on", async () => {
    mocks.existsSync.mockImplementation((path: string) => path === LOCAL_TRANSCRIBE_SCRIPT);
    vi.stubEnv("TRANSCRIBE_LOCAL_ENABLED", "1");
    execImpl(() => ({ stdout: "system text" }));

    expect(isTranscribeLocalAvailable()).toBe(true);
    expect(await transcribeLocal("/tmp/audio.mp3")).toBe("system text");
    expect(commandNames()).toEqual(["python3"]);
  });

  it("returns null when python fails", async () => {
    installLocal();
    execImpl(() => ({ error: new Error("python exited 1"), stderr: "Traceback: boom" }));

    expect(await transcribeLocal("/tmp/audio.mp3")).toBeNull();
  });

  it("returns null on empty output", async () => {
    installLocal();
    execImpl(() => ({ stdout: "   \n" }));

    expect(await transcribeLocal("/tmp/audio.mp3")).toBeNull();
  });
});

describe("fetchYoutubeTranscript fallback chain", () => {
  const URL = "https://www.youtube.com/watch?v=vid123";

  it("uses the local model when captions are missing and no API key is set", async () => {
    installLocal();
    execImpl((command, args) => {
      if (command === "yt-dlp") {
        return args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {};
      }
      return { stdout: LONG_TRANSCRIPT };
    });

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({
      videoId: "vid123",
      title: "AI video",
      text: LONG_TRANSCRIPT,
      kind: "local",
    });
    expect(commandNames()).toEqual(["yt-dlp", "yt-dlp", VENV_PYTHON]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps rejecting when captions, local model and API key are all absent", async () => {
    execImpl((command, args) =>
      command === "yt-dlp" && args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {},
    );

    expect(await fetchYoutubeTranscript(URL)).toBeNull();
    expect(commandNames()).toEqual(["yt-dlp"]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("prefers native subtitles over the local model", async () => {
    installLocal();
    const info = { ...VIDEO, subtitles: { en: [{ ext: "json3", url: "https://subs.example/en.json3" }] } };
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ events: [{ segs: [{ utf8: LONG_TRANSCRIPT }] }] }),
    });
    execImpl((command, args) =>
      command === "yt-dlp" && args.includes("--dump-json")
        ? ytdlpInfo(info)
        : { error: new Error("audio must not be downloaded") },
    );

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({ kind: "native", lang: "en", text: LONG_TRANSCRIPT });
    expect(commandNames()).toEqual(["yt-dlp"]);
  });

  it("falls back to automatic captions when no native track exists", async () => {
    const info = {
      ...VIDEO,
      automatic_captions: { en: [{ ext: "json3", url: "https://subs.example/auto.json3" }] },
    };
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ events: [{ segs: [{ utf8: LONG_TRANSCRIPT }] }] }),
    });
    execImpl((command, args) =>
      command === "yt-dlp" && args.includes("--dump-json")
        ? ytdlpInfo(info)
        : { error: new Error("audio must not be downloaded") },
    );

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({ kind: "auto", text: LONG_TRANSCRIPT });
  });

  it("routes a too-short caption track to the local model", async () => {
    installLocal();
    const info = { ...VIDEO, subtitles: { en: [{ ext: "json3", url: "https://subs.example/short.json3" }] } };
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ events: [{ segs: [{ utf8: "hi" }] }] }),
    });
    execImpl((command, args) => {
      if (command !== "yt-dlp") return { stdout: LONG_TRANSCRIPT };
      return args.includes("--dump-json") ? ytdlpInfo(info) : {};
    });

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({ kind: "local", text: LONG_TRANSCRIPT });
  });

  it("prefers the free local model over a configured HTTP Whisper key", async () => {
    installLocal();
    vi.stubEnv("WHISPER_API_KEY", "test-key");
    execImpl((command, args) => {
      if (command !== "yt-dlp") return { stdout: LONG_TRANSCRIPT };
      return args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {};
    });

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({ kind: "local", text: LONG_TRANSCRIPT });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the HTTP API when the local model fails", async () => {
    installLocal();
    vi.stubEnv("WHISPER_API_KEY", "test-key");
    mocks.readFile.mockResolvedValue(Buffer.from("audio bytes"));
    apiFetch();
    execImpl((command, args) => {
      if (command === "yt-dlp") return args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {};
      return { error: new Error("local whisper crashed") };
    });

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({ kind: "whisper", text: LONG_TRANSCRIPT });
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/audio/transcriptions"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("still uses the HTTP API when only a key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mocks.readFile.mockResolvedValue(Buffer.from("audio bytes"));
    apiFetch();
    execImpl((command, args) =>
      command === "yt-dlp" && args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {},
    );

    const result = await fetchYoutubeTranscript(URL);

    expect(result).toMatchObject({ kind: "whisper", text: LONG_TRANSCRIPT });
  });

  it("honours TRANSCRIBE_LOCAL_ENABLED=0 even with the venv installed", async () => {
    installLocal();
    vi.stubEnv("TRANSCRIBE_LOCAL_ENABLED", "0");
    execImpl((command, args) =>
      command === "yt-dlp" && args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {},
    );

    expect(await fetchYoutubeTranscript(URL)).toBeNull();
    expect(commandNames()).toEqual(["yt-dlp"]);
  });

  it("rejects a local transcript that is too short to summarize", async () => {
    installLocal();
    execImpl((command, args) => {
      if (command !== "yt-dlp") return { stdout: "too short" };
      return args.includes("--dump-json") ? ytdlpInfo(VIDEO) : {};
    });

    expect(await fetchYoutubeTranscript(URL)).toBeNull();
  });
});

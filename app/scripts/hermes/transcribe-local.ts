/**
 * transcribe-local.ts — free, offline Whisper fallback for YouTube audio.
 *
 * The HTTP Whisper API needs a key and burns a quota; a small faster-whisper
 * model runs on a 2-core CPU and costs nothing. This module only locates the
 * Python interpreter and the script — the model itself lives in
 * /opt/whisper-venv and is installed by scripts/deploy/install-whisper.sh.
 *
 * Environment:
 *   TRANSCRIBE_LOCAL_ENABLED     "0"/"false" disables even when installed;
 *                                "1"/"true" also allows a system python3.
 *                                Default: on when the venv and script exist.
 *   TRANSCRIBE_LOCAL_MODEL       faster-whisper model name (default "small").
 *   TRANSCRIBE_LOCAL_TIMEOUT_MS  hard kill timeout (default 15 min for CPU).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Interpreter installed by scripts/deploy/install-whisper.sh. */
export const VENV_PYTHON = "/opt/whisper-venv/bin/python";
/** Used only when TRANSCRIBE_LOCAL_ENABLED is explicitly on (no venv). */
const SYSTEM_PYTHON = "python3";

export const LOCAL_TRANSCRIBE_SCRIPT = fileURLToPath(
  new URL("./transcribe_local.py", import.meta.url),
);

export const DEFAULT_LOCAL_MODEL = "small";
/** A 30-minute video on 2 CPU cores can take well over 5 minutes. */
export const DEFAULT_LOCAL_TIMEOUT_MS = 15 * 60_000;

const MIN_LOCAL_TIMEOUT_MS = 1_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MODEL_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export interface LocalTranscribeOptions {
  /** Overrides TRANSCRIBE_LOCAL_MODEL. */
  model?: string;
  /** Overrides TRANSCRIBE_LOCAL_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** null = variable is unset or not a recognised switch. */
function parseEnabledFlag(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return null;
  }
}

/** Venv python when installed, otherwise the system interpreter (opt-in). */
export function resolvePython(): string {
  return existsSync(VENV_PYTHON) ? VENV_PYTHON : SYSTEM_PYTHON;
}

/**
 * Local transcription is on by default only when both the script and the venv
 * are present. An explicit TRANSCRIBE_LOCAL_ENABLED=1 opts into a system
 * python3 (useful on a dev machine); =0 always wins.
 */
export function isTranscribeLocalAvailable(): boolean {
  if (!existsSync(LOCAL_TRANSCRIBE_SCRIPT)) return false;
  const flag = parseEnabledFlag(process.env.TRANSCRIBE_LOCAL_ENABLED);
  if (flag === false) return false;
  if (flag === true) return true;
  return existsSync(VENV_PYTHON);
}

export function resolveLocalModel(raw: string | undefined = process.env.TRANSCRIBE_LOCAL_MODEL): string {
  const model = (raw ?? "").trim();
  return MODEL_NAME_RE.test(model) ? model : DEFAULT_LOCAL_MODEL;
}

export function resolveLocalTimeoutMs(
  raw: string | undefined = process.env.TRANSCRIBE_LOCAL_TIMEOUT_MS,
): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= MIN_LOCAL_TIMEOUT_MS
    ? parsed
    : DEFAULT_LOCAL_TIMEOUT_MS;
}

function lastLine(value: string | Buffer | undefined): string {
  return String(value ?? "")
    .trim()
    .split(/\r?\n/)
    .pop()!
    .slice(-300);
}

/**
 * Transcribe an audio file with the local faster-whisper model.
 * Returns the raw text or null — never throws, so the caller can fall through
 * to the HTTP API (or reject the video) instead of crashing the pipeline.
 */
export function transcribeLocal(
  audioPath: string,
  options: LocalTranscribeOptions = {},
): Promise<string | null> {
  if (!isTranscribeLocalAvailable()) {
    console.error(
      "[transcribe-local] disabled or not installed (TRANSCRIBE_LOCAL_ENABLED, script, /opt/whisper-venv)",
    );
    return Promise.resolve(null);
  }
  if (!audioPath || audioPath.startsWith("-")) {
    console.error("[transcribe-local] invalid audio path");
    return Promise.resolve(null);
  }

  const python = resolvePython();
  const model = options.model ?? resolveLocalModel();
  const timeout = options.timeoutMs ?? resolveLocalTimeoutMs();

  return new Promise((resolve) => {
    // execFile (no shell): the path and the model are single argv elements.
    // `--` terminates options so a path starting with "-" stays positional.
    execFile(
      python,
      [LOCAL_TRANSCRIBE_SCRIPT, "--model", model, "--", audioPath],
      { timeout, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const reason = error.killed ? `timed out after ${timeout} ms` : error.message;
          console.error(`[transcribe-local] ${python} failed: ${reason.slice(0, 200)}`);
          const detail = lastLine(stderr);
          if (detail) console.error(`[transcribe-local] stderr: ${detail}`);
          resolve(null);
          return;
        }
        const text = String(stdout ?? "").trim();
        resolve(text || null);
      },
    );
  });
}

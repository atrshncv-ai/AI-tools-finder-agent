/**
 * youtube-transcript.ts — YouTube ingestion for the Hermes pipeline.
 *
 * Uses yt-dlp (no API key, no token burn) to pull video metadata and
 * subtitles — native subs first, auto-generated captions as fallback —
 * then normalizes them to plain text for the Zen summarizer.
 *
 * Principles borrowed from the `claude-video` skill: never download the
 * video itself when a subtitle track exists; treat the transcript as
 * untrusted data; fail fast when no captions are available.
 */

import { execFile } from "node:child_process";
import { readFile, unlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const YTDLP_TIMEOUT_MS = 90_000;
const SUB_FETCH_TIMEOUT_MS = 20_000;
const MIN_TRANSCRIPT_CHARS = 200;

// ─── Whisper audio fallback (shorts without captions) ───────────────────────
// Provider-agnostic OpenAI-compatible audio API: Groq (default, free tier) or
// OpenAI. Configured purely via env; disabled when no key is present.
const WHISPER_API_KEY =
  process.env.WHISPER_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "";
const WHISPER_API_BASE = (process.env.WHISPER_API_BASE || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-large-v3-turbo";
const AUDIO_DL_TIMEOUT_MS = 240_000;
const WHISPER_TIMEOUT_MS = 120_000;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // keep under the 25MB API limit

export interface YoutubeTranscript {
  videoId: string;
  title: string;
  description: string;
  channel: string;
  durationSeconds: number | null;
  /** Clean plain-text transcript. */
  text: string;
  lang: string;
  kind: "native" | "auto" | "whisper";
}

/** youtube.com/watch?v=, youtube.com/shorts/<id>, youtu.be/<id> links. */
export function isYoutubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts)(?:[/?#]|$)|youtu\.be\/)/i.test(url);
}

interface YtdlpSubtitleTrack {
  ext: string;
  url: string;
  name?: string;
}

interface YtdlpInfo {
  id?: string;
  title?: string;
  description?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  language?: string;
  subtitles?: Record<string, YtdlpSubtitleTrack[]>;
  automatic_captions?: Record<string, YtdlpSubtitleTrack[]>;
}

function runYtdlp(url: string): Promise<YtdlpInfo | null> {
  return new Promise((resolve) => {
    // execFile (no shell) — the URL is passed as a single argv element.
    execFile(
      "yt-dlp",
      ["--dump-json", "--skip-download", "--no-playlist", "--no-warnings", "--js-runtimes", "deno", url],
      { timeout: YTDLP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          console.error(`[youtube] yt-dlp failed: ${err ? String(err.message).slice(0, 160) : "empty output"}`);
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as YtdlpInfo);
        } catch {
          console.error("[youtube] yt-dlp returned invalid JSON");
          resolve(null);
        }
      },
    );
  });
}

/**
 * Pick the best subtitle track: English first, then any language (Russian
 * channels are summarized by the LLM directly — no translation needed).
 */
function pickTrack(
  tracks: Record<string, YtdlpSubtitleTrack[]> | undefined,
): { lang: string; track: YtdlpSubtitleTrack } | null {
  if (!tracks) return null;
  const langs = Object.keys(tracks);
  const preferred = [
    "en",
    langs.find((l) => /^en[-_]/i.test(l) && !/auto/i.test(l)),
    langs.find((l) => /^en/i.test(l)),
    ...langs, // any language as last resort
  ].filter((x): x is string => Boolean(x));
  for (const lang of preferred) {
    const variants = tracks[lang];
    if (!variants?.length) continue;
    // json3 is trivially parseable; vtt as fallback.
    const track = variants.find((v) => v.ext === "json3") ?? variants.find((v) => v.ext === "vtt") ?? variants[0];
    if (track?.url) return { lang, track };
  }
  return null;
}

function parseJson3(raw: string): string {
  try {
    const data = JSON.parse(raw) as { events?: { segs?: { utf8?: string }[] }[] };
    const parts: string[] = [];
    for (const ev of data.events ?? []) {
      const line = (ev.segs ?? []).map((s) => s.utf8 ?? "").join("");
      if (line.trim()) parts.push(line);
    }
    return parts.join(" ");
  } catch {
    return "";
  }
}

function parseVtt(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let prev = "";
  for (let line of lines) {
    if (/^(WEBVTT|Kind:|Language:|NOTE)/.test(line)) continue;
    if (/-->/.test(line)) continue; // timestamp line
    line = line.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (!line || line === prev) continue; // vtt repeats lines across cue windows
    prev = line;
    out.push(line);
  }
  return out.join(" ");
}

async function fetchSubtitleText(track: YtdlpSubtitleTrack): Promise<string> {
  try {
    const res = await fetch(track.url, { signal: AbortSignal.timeout(SUB_FETCH_TIMEOUT_MS) });
    if (!res.ok) return "";
    const raw = await res.text();
    if (track.ext === "json3") return parseJson3(raw);
    return parseVtt(raw);
  } catch {
    return "";
  }
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  url: string;
  /** Parsed from upload_date (YYYYMMDD); null when unavailable. */
  publishedAt: Date | null;
}

/**
 * List the newest videos of a channel via yt-dlp (fallback for channels whose
 * RSS feed 404s — YouTube's feeds endpoint is flaky for some channels/IPs).
 * Full per-video metadata extraction is used because flat playlists carry no
 * upload dates, and the pipeline's Time Guard is fail-closed on missing dates.
 */
export function listChannelVideos(channelUrl: string, max = 5): Promise<ChannelVideo[]> {
  return new Promise((resolve) => {
    execFile(
      "yt-dlp",
      [
        "--skip-download",
        "--no-warnings", "--js-runtimes", "deno",
        "--playlist-end",
        String(max),
        "--print",
        "%(id)s\t%(title)s\t%(upload_date)s\t%(webpage_url)s",
        channelUrl,
      ],
      { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          console.error(`[youtube] channel listing failed for ${channelUrl}: ${err ? String(err.message).slice(0, 120) : "empty"}`);
          resolve([]);
          return;
        }
        const out: ChannelVideo[] = [];
        for (const line of stdout.split(/\r?\n/)) {
          const [id, title, uploadDate, url] = line.split("\t");
          if (!id || !title || !url) continue;
          const m = /^(\d{4})(\d{2})(\d{2})$/.exec(uploadDate ?? "");
          out.push({
            videoId: id,
            title: title.trim(),
            url: url.trim(),
            publishedAt: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null,
          });
        }
        resolve(out);
      },
    );
  });
}

/** Lightweight metadata (no subtitle download) — used by the scorer. */
export async function fetchYoutubeMetadata(
  url: string,
): Promise<{ title: string; description: string; channel: string } | null> {
  if (!isYoutubeUrl(url)) return null;
  const info = await runYtdlp(url);
  if (!info?.id) return null;
  return {
    title: info.title ?? "",
    description: info.description ?? "",
    channel: info.channel ?? info.uploader ?? "",
  };
}

/** Download audio track via yt-dlp+ffmpeg (16kHz mono 32kbps, capped at 30min). */
function downloadAudio(url: string, videoId: string): Promise<string | null> {
  const outTemplate = join(tmpdir(), `yt-audio-${videoId}.%(ext)s`);
  return new Promise((resolve) => {
    execFile(
      "yt-dlp",
      [
        "-x",
        "--audio-format", "mp3",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1 -b:a 32k -t 1800",
        "--no-playlist",
        "--no-warnings",
        "--js-runtimes", "deno",
        "-o", outTemplate,
        url,
      ],
      { timeout: AUDIO_DL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err) => {
        if (err) {
          console.error(`[youtube] audio download failed: ${String(err.message).slice(0, 160)}`);
          resolve(null);
          return;
        }
        resolve(join(tmpdir(), `yt-audio-${videoId}.mp3`));
      },
    );
  });
}

async function cleanupAudio(videoId: string): Promise<void> {
  try {
    const files = await readdir(tmpdir());
    for (const f of files) {
      if (f.startsWith(`yt-audio-${videoId}`)) {
        await unlink(join(tmpdir(), f)).catch(() => {});
      }
    }
  } catch {
    // best-effort cleanup
  }
}

/** Whisper API (OpenAI-compatible: Groq by default) transcription of a video's audio. */
async function transcribeWithWhisper(url: string, videoId: string): Promise<string | null> {
  if (!WHISPER_API_KEY) {
    console.error("[youtube] whisper fallback disabled (no WHISPER_API_KEY/GROQ_API_KEY/OPENAI_API_KEY)");
    return null;
  }
  const audioPath = await downloadAudio(url, videoId);
  if (!audioPath) return null;
  try {
    const bytes = await readFile(audioPath);
    if (bytes.length > MAX_AUDIO_BYTES) {
      console.error(`[youtube] audio too large for whisper (${bytes.length} bytes)`);
      return null;
    }
    const form = new FormData();
    form.append("model", WHISPER_MODEL);
    form.append("response_format", "text");
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), `${videoId}.mp3`);

    const res = await fetch(`${WHISPER_API_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHISPER_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[youtube] whisper API error: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const text = (await res.text()).trim();
    return text.length >= MIN_TRANSCRIPT_CHARS ? text : null;
  } catch (err) {
    console.error(`[youtube] whisper transcription failed: ${String(err).slice(0, 160)}`);
    return null;
  } finally {
    await cleanupAudio(videoId);
  }
}

/**
 * Fetch transcript for a YouTube video. Returns null when the video is
 * unavailable and neither captions nor Whisper audio transcription work.
 */
export async function fetchYoutubeTranscript(url: string): Promise<YoutubeTranscript | null> {
  if (!isYoutubeUrl(url)) return null;

  const info = await runYtdlp(url);
  if (!info?.id) return null;

  // Native subtitles first, auto-generated captions as fallback.
  const native = pickTrack(info.subtitles);
  const picked = native
    ? { ...native, kind: "native" as const }
    : (() => {
        const auto = pickTrack(info.automatic_captions);
        return auto ? { ...auto, kind: "auto" as const } : null;
      })();

  // Whisper fallback: no caption track OR track too short (common for shorts).
  const buildResult = (text: string, lang: string, kind: YoutubeTranscript["kind"]): YoutubeTranscript => ({
    videoId: info.id!,
    title: info.title ?? "",
    description: (info.description ?? "").slice(0, 2000),
    channel: info.channel ?? info.uploader ?? "",
    durationSeconds: typeof info.duration === "number" ? info.duration : null,
    text,
    lang,
    kind,
  });

  if (!picked) {
    console.error(`[youtube] no subtitles/captions for ${url} — trying whisper fallback`);
    const wtext = await transcribeWithWhisper(url, info.id);
    return wtext ? buildResult(wtext, info.language ?? "unknown", "whisper") : null;
  }

  const text = (await fetchSubtitleText(picked.track)).replace(/\s+/g, " ").trim();
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    console.error(`[youtube] transcript too short (${text.length} chars) for ${url} — trying whisper fallback`);
    const wtext = await transcribeWithWhisper(url, info.id);
    return wtext ? buildResult(wtext, info.language ?? "unknown", "whisper") : null;
  }

  return buildResult(text, picked.lang, picked.kind);
}

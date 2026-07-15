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

const YTDLP_TIMEOUT_MS = 90_000;
const SUB_FETCH_TIMEOUT_MS = 20_000;
const MIN_TRANSCRIPT_CHARS = 200;

export interface YoutubeTranscript {
  videoId: string;
  title: string;
  description: string;
  channel: string;
  durationSeconds: number | null;
  /** Clean plain-text transcript. */
  text: string;
  lang: string;
  kind: "native" | "auto";
}

/** youtube.com/watch?v=, youtube.com/shorts/, youtu.be/ links. */
export function isYoutubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts)\/|youtu\.be\/)/i.test(url);
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
  subtitles?: Record<string, YtdlpSubtitleTrack[]>;
  automatic_captions?: Record<string, YtdlpSubtitleTrack[]>;
}

function runYtdlp(url: string): Promise<YtdlpInfo | null> {
  return new Promise((resolve) => {
    // execFile (no shell) — the URL is passed as a single argv element.
    execFile(
      "yt-dlp",
      ["--dump-json", "--skip-download", "--no-playlist", "--no-warnings", url],
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

/** Pick the best English track: exact 'en', then en-* variants. */
function pickEnglishTrack(
  tracks: Record<string, YtdlpSubtitleTrack[]> | undefined,
): { lang: string; track: YtdlpSubtitleTrack } | null {
  if (!tracks) return null;
  const langs = Object.keys(tracks);
  const preferred = [
    "en",
    langs.find((l) => /^en[-_]/i.test(l) && !/auto/i.test(l)),
    langs.find((l) => /^en/i.test(l)),
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

/**
 * Fetch transcript for a YouTube video. Returns null when the video is
 * unavailable or has no usable caption track.
 */
export async function fetchYoutubeTranscript(url: string): Promise<YoutubeTranscript | null> {
  if (!isYoutubeUrl(url)) return null;

  const info = await runYtdlp(url);
  if (!info?.id) return null;

  // Native subtitles first, auto-generated captions as fallback.
  const native = pickEnglishTrack(info.subtitles);
  const picked = native
    ? { ...native, kind: "native" as const }
    : (() => {
        const auto = pickEnglishTrack(info.automatic_captions);
        return auto ? { ...auto, kind: "auto" as const } : null;
      })();

  if (!picked) {
    console.error(`[youtube] no English subtitles/captions for ${url}`);
    return null;
  }

  const text = (await fetchSubtitleText(picked.track)).replace(/\s+/g, " ").trim();
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    console.error(`[youtube] transcript too short (${text.length} chars) for ${url}`);
    return null;
  }

  return {
    videoId: info.id,
    title: info.title ?? "",
    description: (info.description ?? "").slice(0, 2000),
    channel: info.channel ?? info.uploader ?? "",
    durationSeconds: typeof info.duration === "number" ? info.duration : null,
    text,
    lang: picked.lang,
    kind: picked.kind,
  };
}

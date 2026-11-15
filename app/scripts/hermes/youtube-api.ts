/**
 * youtube-api.ts — read-only YouTube Data API v3 client on plain fetch.
 *
 * Why: on the production host youtube.com is blocked by hostname while
 * youtube.googleapis.com answers. yt-dlp and the public Atom feed therefore
 * cannot see any channel, but the official Data API still returns the metadata
 * the pipeline needs (title, description, upload date) from an allowed host.
 *
 * No dependencies, no token burn: two list calls per channel plus one optional
 * durations call. The key comes from the env `YOUTUBE_API_KEY` on every call;
 * with no key every function returns null, so the caller silently keeps its
 * legacy RSS/yt-dlp path. An exhausted daily quota (HTTP 403/429
 * `quotaExceeded`) is a distinct `YouTubeQuotaError` so the collector can stop
 * calling the API instead of burning the remaining requests.
 *
 * API keys are secrets: request URLs are never logged, they carry `?key=`.
 */

const API_BASE = "https://youtube.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESULTS_LIMIT = 50;
const SECONDS_PER_DAY = 86_400;

/** Daily quota / rate limit exhausted — a configuration state, not a bug. */
export class YouTubeQuotaError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`YouTube API quota exceeded (HTTP ${status}): ${body.slice(0, 200)}`);
    this.name = "YouTubeQuotaError";
    this.status = status;
  }
}

export interface YouTubeChannel {
  channelId: string;
  title: string;
  /** `contentDetails.relatedPlaylists.uploads` — the channel's uploads playlist. */
  uploadsPlaylistId: string;
}

export interface YouTubeUpload {
  videoId: string;
  title: string;
  /** Full description from the API — the collector stores it as the lead. */
  description: string;
  /**
   * Upload date (`contentDetails.videoPublishedAt`), falling back to the
   * playlist-item date. Null when the API omits or corrupts it; the collector's
   * Time Guard then drops the item (fail-closed).
   */
  publishedAt: Date | null;
}

export interface YouTubeApiOptions {
  /** Injectable fetch for tests; defaults to the global implementation. */
  fetchImpl?: typeof fetch;
  /** Explicit key; `undefined` reads env `YOUTUBE_API_KEY`, `null` disables calls. */
  apiKey?: string | null;
}

type ApiList = "channels" | "playlistItems" | "videos";
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asItems(data: JsonRecord): unknown[] {
  return Array.isArray(data.items) ? data.items : [];
}

/** Key from env; empty or whitespace means "API disabled". */
export function youtubeApiKey(): string | null {
  const key = (process.env.YOUTUBE_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

/** `TwoMinutePapers` and `@TwoMinutePapers` both resolve to `@TwoMinutePapers`. */
export function normalizeHandle(handle: string): string | null {
  const bare = (handle ?? "").trim().replace(/^@+/, "");
  if (!bare || !/^[A-Za-z0-9._-]+$/.test(bare)) return null;
  return `@${bare}`;
}

/** The one URL shape the rest of the pipeline accepts for a video. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId.trim())}`;
}

/**
 * ISO 8601 duration (`PT1H2M3S`, `P1DT2H`) → seconds. Returns null on any
 * shape the API does not send, so a bad value never fabricates a duration.
 */
export function parseIso8601Duration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  return days * SECONDS_PER_DAY + hours * 3600 + minutes * 60 + seconds;
}

function normalizeMaxResults(max: number): number {
  const value = Number.isFinite(max) ? Math.trunc(max) : MAX_RESULTS_LIMIT;
  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, value));
}

function parseApiDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 403/429 with a quota reason is a hard stop; every other error is transient. */
function isQuotaExhausted(status: number, body: string): boolean {
  if (status !== 403 && status !== 429) return false;
  return /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|exceeded your quota/i.test(body);
}

/**
 * One API GET. Returns null when the API is disabled, unreachable or answers
 * with a non-quota error — the caller's legacy path then stays in charge.
 * Only an explicit quota rejection throws (YouTubeQuotaError).
 */
async function apiGet(
  list: ApiList,
  params: Record<string, string | number>,
  options: YouTubeApiOptions,
): Promise<JsonRecord | null> {
  const apiKey = options.apiKey === undefined ? youtubeApiKey() : options.apiKey?.trim() || null;
  if (!apiKey) return null;

  const url = new URL(`${API_BASE}/${list}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }
  url.searchParams.set("key", apiKey);

  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let status: number;
  let ok: boolean;
  let body: string;
  try {
    const response = await doFetch(url.toString(), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    status = response.status;
    ok = response.ok;
    body = await response.text();
  } catch (err) {
    console.error(`[youtube-api] ${list}: request failed (${(err as Error).message.slice(0, 120)})`);
    return null;
  }

  if (!ok) {
    if (isQuotaExhausted(status, body)) throw new YouTubeQuotaError(status, body);
    console.error(`[youtube-api] ${list}: HTTP ${status} (${body.slice(0, 160)})`);
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(body);
    const record = asRecord(parsed);
    if (!record) {
      console.error(`[youtube-api] ${list}: response is not a JSON object`);
      return null;
    }
    return record;
  } catch {
    console.error(`[youtube-api] ${list}: response is not valid JSON`);
    return null;
  }
}

/**
 * GET channels?part=contentDetails,snippet&forHandle=@name
 * → channelId + the uploads playlist that `listUploads` reads.
 */
export async function resolveChannel(
  handle: string,
  options: YouTubeApiOptions = {},
): Promise<YouTubeChannel | null> {
  const normalized = normalizeHandle(handle);
  if (!normalized) {
    console.error(`[youtube-api] invalid channel handle: ${String(handle).slice(0, 80)}`);
    return null;
  }
  const data = await apiGet(
    "channels",
    { part: "contentDetails,snippet", forHandle: normalized },
    options,
  );
  if (!data) return null;

  const item = asRecord(asItems(data)[0]);
  if (!item) {
    console.error(`[youtube-api] channels.list returned no channel for ${normalized}`);
    return null;
  }
  const channelId = asString(item.id);
  const uploadsPlaylistId = asString(
    asRecord(asRecord(item.contentDetails)?.relatedPlaylists)?.uploads,
  );
  if (!channelId || !uploadsPlaylistId) {
    console.error(`[youtube-api] channels.list item for ${normalized} has no uploads playlist`);
    return null;
  }
  return {
    channelId,
    title: asString(asRecord(item.snippet)?.title) ?? "",
    uploadsPlaylistId,
  };
}

/**
 * GET playlistItems?part=snippet,contentDetails&playlistId=...&maxResults=N
 * → newest uploads with title, description and upload date.
 */
export async function listUploads(
  playlistId: string,
  max: number,
  options: YouTubeApiOptions = {},
): Promise<YouTubeUpload[] | null> {
  const id = (playlistId ?? "").trim();
  if (!id) return null;

  const data = await apiGet(
    "playlistItems",
    {
      part: "snippet,contentDetails",
      playlistId: id,
      maxResults: normalizeMaxResults(max),
    },
    options,
  );
  if (!data) return null;

  const uploads: YouTubeUpload[] = [];
  for (const raw of asItems(data)) {
    const item = asRecord(raw);
    if (!item) continue;
    const details = asRecord(item.contentDetails);
    const snippet = asRecord(item.snippet);
    const videoId = asString(details?.videoId);
    const title = asString(snippet?.title);
    if (!videoId || !title) continue;
    uploads.push({
      videoId,
      title,
      description: asString(snippet?.description) ?? "",
      publishedAt:
        parseApiDate(asString(details?.videoPublishedAt)) ??
        parseApiDate(asString(snippet?.publishedAt)),
    });
  }
  return uploads;
}

/**
 * GET videos?part=contentDetails&id=a,b,c → duration seconds per video id.
 * Optional enrichment for short lists; a missing id stays absent from the map.
 */
export async function listVideoDurations(
  videoIds: string[],
  options: YouTubeApiOptions = {},
): Promise<Map<string, number | null> | null> {
  const ids = [...new Set((videoIds ?? []).map((id) => id.trim()).filter(Boolean))].slice(
    0,
    MAX_RESULTS_LIMIT,
  );
  if (ids.length === 0) return new Map();

  const data = await apiGet(
    "videos",
    { part: "contentDetails", id: ids.join(",") },
    options,
  );
  if (!data) return null;

  const durations = new Map<string, number | null>();
  for (const raw of asItems(data)) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = asString(item.id);
    if (!id) continue;
    durations.set(id, parseIso8601Duration(asString(asRecord(item.contentDetails)?.duration)));
  }
  return durations;
}

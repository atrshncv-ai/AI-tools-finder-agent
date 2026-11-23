#!/usr/bin/env tsx
/**
 * collect-dual.ts — Dual Pipeline collector (elite curation, no blind scraping).
 *
 * Tech stream (AI tools & IT):
 *   - Official blogs RSS: OpenAI, Anthropic, Hugging Face, Google AI
 *   - Trend signals via lightweight JSON APIs (no browser screenshots, no token burn):
 *       Hacker News (Algolia API), GitHub (REST search API), Reddit (public JSON)
 *
 * Science stream:
 *   - Tier-1 journals RSS: Nature, Science, Cell
 *   - AI × science journals (Nature Machine Intelligence/Methods, Cell Systems,
 *     Patterns) and targeted AI PubMed searches — the general feeds carry few
 *     AI papers, so the AI gate used to starve the «Наука» section
 *   - MIT Technology Review, arXiv API (categories + AI-filtered), Naked Science (ru)
 *
 * Every feed is downloaded through feed-fetch.ts (UA ladder, XML Accept header,
 * one paced retry, per-host interval) and parsed from the returned text: a
 * publisher that blocks one UA or rate-limits a burst no longer drops the whole
 * source from the run. A feed that fails every strategy is skipped, logged
 * without its body and recorded in source health — the loop goes on.
 *
 * Every candidate passes the Semantic Deduplication Guard (dedup.ts) BEFORE
 * insertion: exact URL check, then Levenshtein >= 0.85 against last 20 titles.
 * Inserted articles: status='pending', score=NULL (awaiting evaluate-news.ts).
 *
 * Usage:
 *   npx tsx scripts/hermes/collect-dual.ts [--stream tech|science|both] [--dry-run]
 *
 * Exit codes: 0 = success, 1 = fatal error
 */

import "dotenv/config";
import Parser from "rss-parser";
import { getDb } from "../../api/queries/connection";
import { news, categories } from "@db/schema";
import { eq } from "drizzle-orm";
import { isDuplicate } from "./dedup";
import { listChannelVideos } from "./youtube-transcript";
import { YOUTUBE_SOURCES, type YoutubeSource } from "./youtube-sources";
import {
  YouTubeQuotaError,
  listUploads,
  listVideoDurations,
  resolveChannel,
  watchUrl,
  youtubeApiKey,
  type YouTubeUpload,
} from "./youtube-api";
import { ssrfCheck } from "../../api/lib/url-safety";
import { classifyScience } from "../ensure-science-categories";
import { resolveSection, type SectionResolution } from "../../api/lib/section-resolve";
import { classifyInvention, buildInventionContext } from "../../api/lib/invention-classify";
import { recordFeedHealth } from "./feed-health";
import { BROWSER_UA, fetchFeed, type FeedFetchDeps, type FeedStrategy } from "./feed-fetch";

const FETCH_TIMEOUT_MS = 20_000;
const HN_MIN_POINTS = 100;
const GITHUB_MIN_STARS = 300;
const GITHUB_LOOKBACK_DAYS = 3;
const MAX_AGE_HOURS_DEFAULT = 72;
const MAX_AGE_MS = MAX_AGE_HOURS_DEFAULT * 3600_000;

/**
 * STRICT Time Guard: every candidate must carry a valid publication/creation
 * date no older than 72h. Missing or unparseable date => REJECTED (fail-closed).
 * Runs at collection time, BEFORE dedup/scoring — no exceptions for any source.
 */
export function isFresh(publishedAt: Date | null | undefined, maxAgeMs = MAX_AGE_MS, minAgeMs = 0): boolean {
  if (!publishedAt) return false;
  const ts = publishedAt.getTime?.();
  if (!ts || Number.isNaN(ts)) return false;
  const age = Date.now() - ts;
  return age <= maxAgeMs && age >= minAgeMs;
}

export interface Candidate {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  language: string;
  isScience: boolean;
  scienceField: string | null;
  /** RSS/YouTube description or abstract, used for richer invention classification. */
  description?: string | null;
  /** Pre-collected hard metrics from the source API (if available). */
  metrics: Record<string, unknown>;
}

/**
 * Values for one `news` insert. The collected description is stored in
 * `summary` — that is the lead the judge and the section router read on the
 * next step (`evaluate-news.ts` takes title + `news.summary`). `save-summary`
 * later overwrites it with the Russian digest text, so the raw lead is only a
 * transport field between collect and evaluate. Dropping it here was the reason
 * the judge used to see a title alone (R18.1).
 */
export function buildNewsRow(
  candidate: Candidate,
  resolution: SectionResolution,
  category: { categoryId: number | null; categorySlug: string | null } = {
    categoryId: null,
    categorySlug: null,
  },
): typeof news.$inferInsert {
  return {
    title: candidate.title.slice(0, 500),
    originalTitle: candidate.title.slice(0, 500),
    summary: (candidate.description ?? "").trim(),
    originalUrl: candidate.url,
    source: candidate.source,
    publishedAt: candidate.publishedAt,
    language: candidate.language,
    isScience: resolution.isScience,
    scienceField: resolution.scienceField,
    section: resolution.section,
    sphereTags: resolution.sphereTags,
    categoryId: category.categoryId,
    categorySlug: category.categorySlug,
    status: "pending",
    metrics: candidate.metrics,
  };
}

const rss = new Parser();

function args() {
  const a = process.argv.slice(2);
  const streamIdx = a.indexOf("--stream");
  const ageIdx = a.indexOf("--max-age-hours");
  const minAgeIdx = a.indexOf("--min-age-hours");
  return {
    stream: (streamIdx >= 0 ? a[streamIdx + 1] : "both") as "tech" | "science" | "both",
    dryRun: a.includes("--dry-run"),
    maxAgeHours: ageIdx >= 0 ? parseInt(a[ageIdx + 1] || "", 10) || MAX_AGE_HOURS_DEFAULT : MAX_AGE_HOURS_DEFAULT,
    minAgeHours: minAgeIdx >= 0 ? parseInt(a[minAgeIdx + 1] || "", 10) || 0 : 0,
  };
}

async function fetchText(url: string): Promise<string | null> {
  // SSRF guard: never follow feed-supplied links into private/internal ranges.
  const blocked = ssrfCheck(url);
  if (blocked) {
    console.error(`[collect-dual] SSRF guard: skipping ${url} (${blocked})`);
    return null;
  }
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Outcome of one feed download+parse. `ok: false` carries a body-free reason so
 * the caller can log it, skip the feed and keep the cycle running.
 */
export interface FeedLoadResult {
  ok: boolean;
  items: Parser.Item[];
  status: number | null;
  /** Which UA fetched it; null when no request succeeded. */
  strategy: FeedStrategy | null;
  error: string | null;
}

/**
 * The only way the collector reads an RSS/Atom feed: feed-fetch.ts downloads it
 * (UA ladder, Accept header, paced retry), rss-parser parses the text. Parse
 * errors are contained here — a broken answer ("Non-whitespace before first
 * tag" from an HTML block page) must not escape into the collection loop.
 */
export async function loadFeedItems(
  url: string,
  deps: FeedFetchDeps = {},
): Promise<FeedLoadResult> {
  const log = deps.log ?? ((message: string) => console.error(message));
  const fetched = await fetchFeed(url, deps);
  if (!fetched.ok || fetched.text === null) {
    return {
      ok: false,
      items: [],
      status: fetched.status,
      strategy: fetched.strategy,
      error: fetched.error ?? "feed unavailable",
    };
  }
  try {
    const parsed = await rss.parseString(fetched.text);
    return {
      ok: true,
      items: parsed.items ?? [],
      status: fetched.status,
      strategy: fetched.strategy,
      error: null,
    };
  } catch (err) {
    const error = `parse: ${((err as Error).message || "invalid XML").slice(0, 120)}`;
    log(`[collect] feed parse failed (${error})`);
    return {
      ok: false,
      items: [],
      status: fetched.status,
      strategy: fetched.strategy,
      error,
    };
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const text = await fetchText(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function fromRssItem(
  item: Parser.Item,
  src: { name: string; isScience: boolean; scienceField: string | null; language: string },
): Candidate | null {
  const title = (item.title || "").trim();
  const url = (item.link || "").trim();
  if (!title || !url || !url.startsWith("http")) return null;
  // STRICT Time Guard is fail-closed: an RSS item without a parseable date
  // cannot be freshness-checked and must not silently pass as "just published".
  if (!item.isoDate) return null;
  const publishedAt = new Date(item.isoDate);
  if (Number.isNaN(publishedAt.getTime())) return null;
  const description = (item.summary || "").trim();
  return {
    title,
    url,
    source: src.name,
    publishedAt,
    language: src.language,
    isScience: src.isScience,
    scienceField: src.scienceField,
    description,
    metrics: { origin: "rss", hasDescription: description.length > 0 },
  };
}

// ─── Feed configuration ──────────────────────────────────────────────────────

/**
 * `language` is the existing marker the judge prompt and manifest already read
 * (`news.language`); Russian-language feeds are collected, but tagged so
 * prefilter/scoring can give them less weight instead of a new flag.
 */
export type FeedLanguage = "en" | "ru";

export interface FeedConfig {
  url: string;
  name: string;
  /**
   * Topical field: an AI-news marker for tech feeds, a science direction for
   * science feeds. Stored as `scienceField` when the feed is a science source.
   */
  field: string;
  language: FeedLanguage;
}

export interface ScienceFeed extends FeedConfig {
  inventionOnly?: boolean;
}

// ─── Tech stream ─────────────────────────────────────────────────────────────

export const TECH_BLOG_FEEDS: FeedConfig[] = [
  { url: "https://openai.com/blog/rss.xml", name: "openai-blog", field: "ai", language: "en" },
  // NOTE: Anthropic has no public RSS feed (404 on all known endpoints).
  // Anthropic releases are picked up via HN/GitHub trend sources instead.
  { url: "https://huggingface.co/blog/feed.xml", name: "huggingface-blog", field: "ai", language: "en" },
  { url: "https://blog.google/technology/ai/rss/", name: "google-ai-blog", field: "ai", language: "en" },
  // REMOVED: deepmind-blog (https://deepmind.google/blog/rss.xml). From the
  // production host it answers with a non-XML page and every run logged
  // "Non-whitespace before first tag". A candidate replacement,
  // https://blog.google/technology/google-deepmind/rss/, answered 200 with
  // application/xml when probed, but it is unverified from the production host:
  // re-add it only after a curl check there.
  // Second-priority Russian-language AI news: tagged `ru`, never translated at
  // collection time, so the existing language marker can down-weight it.
  {
    url: "https://habr.com/ru/rss/hub/artificial_intelligence/",
    name: "habr-ai",
    field: "ai",
    language: "ru",
  },
];

/**
 * Curated AI YouTube channels, ingested by one of two paths:
 *   1. the official Data API (youtube-api.ts) when `YOUTUBE_API_KEY` is set —
 *      the only path that works on the production host, where youtube.com is
 *      blocked by hostname while youtube.googleapis.com answers;
 *   2. the legacy Atom feed + yt-dlp tab crawl below — the no-key fallback and
 *      the fallback when the API is unreachable or out of quota.
 * Videos are transcribed later (youtube-transcript.ts via yt-dlp), never
 * downloaded.
 */

/** Per-channel API budget mirrors the tab crawl: `YOUTUBE_TAB_ITEMS` per tab. */
function youtubeApiItemsPerChannel(source: YoutubeSource): number {
  const tabItems = Math.max(1, parseInt(process.env.YOUTUBE_TAB_ITEMS || "3", 10) || 3);
  return Math.min(50, tabItems * Math.max(1, source.tabs.length));
}

export interface YouTubeApiCollectDeps {
  /** Health sink; injectable so tests never touch the database. */
  recordHealth?: (
    name: string,
    url: string,
    ok: boolean,
    found: number,
    error?: string,
  ) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/**
 * One API upload → collector candidate. `source` is the configured
 * `youtube-<handle>` name (evaluate-news and prefilter key the whole YouTube
 * branch off it), `url` is the canonical watch URL.
 */
export function buildYoutubeApiCandidate(
  source: YoutubeSource,
  upload: YouTubeUpload,
  durationSeconds: number | null = null,
): Candidate {
  return {
    title: upload.title.trim(),
    url: watchUrl(upload.videoId),
    source: source.name,
    // A missing/unparseable date becomes epoch, so the Time Guard drops the
    // item fail-closed exactly like an RSS item without a date.
    publishedAt: upload.publishedAt ?? new Date(0),
    language: source.language,
    isScience: false,
    scienceField: null,
    description: upload.description.trim(),
    metrics: {
      origin: "youtube-api",
      videoId: upload.videoId,
      channelId: source.channelId,
      ...(durationSeconds !== null ? { durationSeconds } : {}),
    },
  };
}

/**
 * Collect every configured channel through the official API.
 * Returns null when the API is not configured or unusable (no key, quota,
 * every channel unreachable), so the caller keeps the legacy RSS/yt-dlp path.
 */
export async function collectYouTubeApi(
  deps: YouTubeApiCollectDeps = {},
): Promise<Candidate[] | null> {
  if (!youtubeApiKey()) return null;

  const recordHealth = deps.recordHealth ?? recordFeedHealth;
  const options = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};
  const out: Candidate[] = [];
  let channelsReached = 0;

  for (const source of YOUTUBE_SOURCES) {
    const healthUrl = `https://youtube.googleapis.com/youtube/v3/channels?forHandle=${source.handle}`;
    try {
      const channel = await resolveChannel(source.handle, options);
      if (!channel) {
        console.error(`[collect] ${source.name}: API channel resolve failed`);
        void recordHealth(
          source.name,
          healthUrl,
          false,
          0,
          "channels.list returned no channel",
        ).catch(() => {});
        continue;
      }
      const uploads = await listUploads(
        channel.uploadsPlaylistId,
        youtubeApiItemsPerChannel(source),
        options,
      );
      if (!uploads) {
        console.error(`[collect] ${source.name}: API uploads failed`);
        void recordHealth(source.name, healthUrl, false, 0, "playlistItems.list failed").catch(
          () => {},
        );
        continue;
      }
      channelsReached++;

      // Optional duration refinement for short lists: one extra quota unit and
      // the 4–45 minute ranking signal survives even without a transcript.
      const durations =
        uploads.length > 0 && uploads.length <= 10
          ? await listVideoDurations(
              uploads.map((upload) => upload.videoId),
              options,
            )
          : null;

      for (const upload of uploads) {
        out.push(
          buildYoutubeApiCandidate(source, upload, durations?.get(upload.videoId) ?? null),
        );
      }
      console.error(`[collect] ${source.name}: ${uploads.length} videos (api)`);
      void recordHealth(source.name, healthUrl, true, uploads.length).catch(() => {});
    } catch (err) {
      if (err instanceof YouTubeQuotaError) {
        // Hard stop: every further call would fail too, so hand the stream
        // back to the legacy path instead of burning the rest of the run.
        console.error(
          `[collect] YouTube API quota exhausted, falling back to RSS/yt-dlp: ${err.message.slice(0, 160)}`,
        );
        return null;
      }
      console.error(
        `[collect] ${source.name}: API failed (${(err as Error).message.slice(0, 120)})`,
      );
      void recordHealth(source.name, healthUrl, false, 0, (err as Error).message).catch(
        () => {},
      );
    }
  }

  if (channelsReached === 0) {
    console.error(
      "[collect] YouTube API unreachable for every channel, falling back to RSS/yt-dlp",
    );
    return null;
  }
  console.error(
    `[collect] youtube-api: ${out.length} videos from ${channelsReached}/${YOUTUBE_SOURCES.length} channels`,
  );
  return out;
}

async function collectYouTube(): Promise<Candidate[]> {
  // Primary path: the official Data API (see the block above). It is skipped
  // when no key is configured or when the API itself is unusable.
  const viaApi = await collectYouTubeApi();
  if (viaApi && viaApi.length > 0) return viaApi;
  if (viaApi) {
    console.error("[collect] YouTube API returned 0 videos, checking RSS/yt-dlp");
  }

  const byUrl = new Map<string, Candidate>();
  const tabItems = Math.max(1, parseInt(process.env.YOUTUBE_TAB_ITEMS || "3", 10));
  for (const source of YOUTUBE_SOURCES) {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`;
    // Health is recorded ONCE per source, combining RSS and yt-dlp tab
    // attempts: many channels return permanent 404 on the RSS endpoint while
    // the tab fallback keeps collecting — reporting them failing produced
    // false ⚠️ in the digest health line (26.08).
    let rssOk = false;
    let rssFound = 0;
    let rssError: string | undefined;
    let tabFound = 0;
    try {
      const loaded = await loadFeedItems(feedUrl);
      if (!loaded.ok) throw new Error(loaded.error ?? "feed unavailable");
      for (const item of loaded.items.slice(0, 10)) {
        const c = fromRssItem(item, {
          name: source.name,
          isScience: false,
          scienceField: null,
          language: source.language,
        });
        if (c) {
          c.metrics = { origin: "youtube-rss", collectionTab: "feed" };
          byUrl.set(c.url, c);
        }
      }
      rssOk = true;
      rssFound = loaded.items.length;
      console.error(`[collect] ${source.name}: ${loaded.items.length} videos (rss)`);
    } catch (err) {
      rssError = (err as Error).message;
      console.error(`[collect] ${source.name}: RSS failed (${rssError})`);
    }

    // Explicit tab collection ensures ordinary long-form videos are not
    // displaced by a burst of Shorts in the mixed RSS feed.
    for (const tab of source.tabs) {
      const channelUrl = `https://www.youtube.com/${source.handle}/${tab}`;
      const videos = await listChannelVideos(channelUrl, tabItems);
      tabFound += videos.length;
      for (const v of videos) {
        byUrl.set(v.url, {
          title: v.title,
          url: v.url,
          source: source.name,
          publishedAt: v.publishedAt ?? new Date(0),
          language: source.language,
          isScience: false,
          scienceField: null,
          metrics: { origin: "youtube-tab", videoId: v.videoId, collectionTab: tab },
        });
      }
      console.error(`[collect] ${source.name}: ${videos.length} ${tab} (yt-dlp)`);
    }

    void recordFeedHealth(
      source.name,
      feedUrl,
      rssOk || tabFound > 0,
      rssFound + tabFound,
      rssOk ? undefined : rssError,
    );
  }
  return [...byUrl.values()];
}

async function collectTechBlogs(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const feed of TECH_BLOG_FEEDS) {
    const loaded = await loadFeedItems(feed.url);
    if (!loaded.ok) {
      const error = loaded.error ?? "feed unavailable";
      console.error(`[collect] ${feed.name}: FAILED (${error})`);
      void recordFeedHealth(feed.name, feed.url, false, 0, error);
      continue;
    }
    for (const item of loaded.items.slice(0, 10)) {
      const c = fromRssItem(item, {
        name: feed.name,
        isScience: false,
        scienceField: null,
        language: feed.language,
      });
      if (c) out.push(c);
    }
    console.error(`[collect] ${feed.name}: ${loaded.items.length} items`);
    void recordFeedHealth(feed.name, feed.url, true, loaded.items.length);
  }
  return out;
}

interface HnHit {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  points?: number;
  created_at_i?: number;
}

async function collectHackerNews(): Promise<Candidate[]> {
  const hnUrl = "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI%20OR%20LLM%20OR%20GPT%20OR%20%22machine%20learning%22&hitsPerPage=40";
  const data = await fetchJson<{ hits: HnHit[] }>(hnUrl);
  if (!data) {
    void recordFeedHealth("hackernews", hnUrl, false, 0, "algolia unreachable");
    return [];
  }
  const cutoff = Date.now() / 1000 - MAX_AGE_MS / 1000;
  const out: Candidate[] = [];
  for (const h of data.hits) {
    const title = h.title || h.story_title || "";
    if (!title || !h.url || (h.points ?? 0) < HN_MIN_POINTS) continue;
    if ((h.created_at_i ?? 0) < cutoff) continue;
    out.push({
      title,
      url: h.url,
      source: "hackernews",
      publishedAt: new Date((h.created_at_i ?? 0) * 1000),
      language: "en",
      isScience: false,
      scienceField: null,
      metrics: { origin: "hn-algolia", hnPoints: h.points, hnObjectId: h.objectID },
    });
  }
  console.error(`[collect] hackernews: ${out.length} hot stories`);
  void recordFeedHealth("hackernews", hnUrl, true, out.length);
  return out;
}

interface GhRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  license?: { spdx_id?: string } | null;
  created_at: string;
  topics?: string[];
}

async function collectGithubTrending(): Promise<Candidate[]> {
  // Global GitHub velocity search: top 50 repos created recently and sorted by
  // stars. Rank is injected into metrics so evaluate-news can award Top-10 / Top-50
  // trending points deterministically.
  const since = new Date(Date.now() - GITHUB_LOOKBACK_DAYS * 86400_000)
    .toISOString()
    .slice(0, 10);
  // Keep <= 4 OR operators to stay inside GitHub's search query limit.
  const q =
    `("ai agent" OR mcp OR rag OR llm) ` +
    `in:name,description,readme created:>=${since} stars:>=${GITHUB_MIN_STARS}`;
  const data = await fetchJson<{ items: GhRepo[] }>(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(
      q,
    )}&sort=stars&order=desc&per_page=50`,
  );
  const ghUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=50`;
  if (!data) void recordFeedHealth("github-trending", ghUrl, false, 0, "github api unreachable");
  const items = data?.items ?? [];
  const out: Candidate[] = items.map((r, idx) => ({
    title: `${r.full_name}${r.description ? " — " + r.description : ""}`,
    url: r.html_url,
    source: "github-trending",
    publishedAt: new Date(r.created_at),
    language: "en",
    isScience: false,
    scienceField: null,
    metrics: {
      origin: "github-api",
      githubTrendingRank: idx + 1,
      githubStars: r.stargazers_count,
      githubLicense: r.license?.spdx_id ?? null,
      githubCreatedAt: r.created_at,
      githubDescription: r.description,
      githubTopics: r.topics ?? [],
    },
  }));
  console.error(`[collect] github-trending: ${out.length} repos`);
  if (data) void recordFeedHealth("github-trending", ghUrl, true, out.length);
  return out;
}

/**
 * Reddit is disabled by policy: the public JSON API is blocked from datacenter
 * IPs and the RSS path carries no upvote counts, so it only added noise. The
 * RSS implementation was removed with the switch to the shared feed downloader
 * (feed-fetch.ts) — nothing here may bypass it.
 */
async function collectReddit(): Promise<Candidate[]> {
  console.error("[collect] reddit: disabled by policy");
  return [];
}

// ─── Science stream ──────────────────────────────────────────────────────────

export const SCIENCE_FEEDS: ScienceFeed[] = [
  { url: "https://www.nature.com/nature.rss", name: "nature", field: "multidisciplinary", language: "en" },
  { url: "https://www.science.org/rss/news_current.xml", name: "science", field: "multidisciplinary", language: "en" },
  // NOTE: Lancet killed its own RSS feeds (410 Gone). PubMed is no longer
  // queried per journal: the targeted AI searches below replace the single
  // Lancet query and follow the customer's topics across all of PubMed.
  { url: "https://www.cell.com/cell/current.rss", name: "cell", field: "biology", language: "en" },
  { url: "https://www.technologyreview.com/feed/", name: "mit-tech-review", field: "technology", language: "en" },
  {
    url: "http://export.arxiv.org/api/query?search_query=all:%22artificial+intelligence%22&sortBy=submittedDate&sortOrder=descending&max_results=25",
    name: "arxiv",
    field: "computer-science",
    language: "en",
  },
  // No-cost arXiv category feeds for AI-for-science tools / emerging tech.
  // Filtered by invention keywords so generic AI papers do not flood the queue.
  {
    url: "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20",
    name: "arxiv-cs-ai",
    field: "computer-science",
    language: "en",
    inventionOnly: true,
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=cat:cs.ET&sortBy=submittedDate&sortOrder=descending&max_results=20",
    name: "arxiv-cs-et",
    field: "computer-science",
    language: "en",
    inventionOnly: true,
  },
  { url: "https://naked-science.ru/?feed=rss2", name: "naked-science", field: "multidisciplinary", language: "ru" },
  // Customer-approved biology/medicine/chemistry/materials feeds. They go
  // through the same collectScience() path: 72h Time Guard, semantic dedup and
  // section/scienceField routing are unchanged.
  {
    url: "https://connect.biorxiv.org/biorxiv_xml.php?subject=all",
    name: "biorxiv",
    field: "biology",
    language: "en",
  },
  {
    url: "https://connect.medrxiv.org/medrxiv_xml.php?subject=all",
    name: "medrxiv",
    field: "medicine",
    language: "en",
  },
  { url: "https://www.nature.com/nbt.rss", name: "nature-biotechnology", field: "biology", language: "en" },
  { url: "https://www.nature.com/nchem.rss", name: "nature-chemistry", field: "chemistry", language: "en" },
  { url: "https://www.nature.com/nmat.rss", name: "nature-materials", field: "materials", language: "en" },
  // Dedicated AI × science outlets: general Nature/Cell feeds publish few AI
  // papers, and the hard AI gate then rejects most of them (customer report:
  // 11 science materials per day against a 5+/5+/5+ target). These journals
  // publish AI methods by definition, so most items clear the gate. Every URL
  // was probed with curl and returned HTTP 200 before it was configured.
  {
    url: "https://www.nature.com/natmachintell.rss",
    name: "nature-machine-intelligence",
    field: "science",
    language: "en",
  },
  { url: "https://www.nature.com/nmeth.rss", name: "nature-methods", field: "biology", language: "en" },
  {
    url: "https://www.cell.com/cell-systems/current.rss",
    name: "cell-systems",
    field: "biology",
    language: "en",
  },
  {
    url: "https://www.cell.com/patterns/current.rss",
    name: "patterns",
    field: "multidisciplinary",
    language: "en",
  },
  // arXiv category feeds request the recent stream directly (no inventionOnly
  // keyword filter): the customer wants these directions represented as-is.
  {
    url: "http://export.arxiv.org/api/query?search_query=cat:q-bio.BM&sortBy=submittedDate&sortOrder=descending&max_results=15",
    name: "arxiv-q-bio-bm",
    field: "biology",
    language: "en",
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=cat:cond-mat.mtrl-sci&sortBy=submittedDate&sortOrder=descending&max_results=15",
    name: "arxiv-cond-mat-mtrl-sci",
    field: "materials",
    language: "en",
  },
  // Same two arXiv categories, but constrained to AI papers. The bare category
  // feeds above are dominated by non-AI work that the AI gate drops, which is
  // exactly why the science stream under-delivered. URLs verified with curl:
  // both return 20 entries.
  {
    url: "http://export.arxiv.org/api/query?search_query=all:%22machine+learning%22+AND+cat:q-bio.BM&sortBy=submittedDate&sortOrder=descending&max_results=20",
    name: "arxiv-ai-q-bio-bm",
    field: "biology",
    language: "en",
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=all:%22deep+learning%22+AND+cat:cond-mat.mtrl-sci&sortBy=submittedDate&sortOrder=descending&max_results=20",
    name: "arxiv-ai-mtrl-sci",
    field: "materials",
    language: "en",
  },
  // Second-priority Russian-language science source, tagged `ru` like
  // naked-science so the existing language marker can down-weight it.
  { url: "https://nplus1.ru/rss", name: "n-plus-one", field: "multidisciplinary", language: "ru" },
  // Owner-verified on 2026-11-15: every URL answered HTTP 200 and returned
  // records. They go through the same collectScience() path, so the strict 72h
  // Time Guard and semantic dedup are unchanged. `field` is the customer
  // direction exactly as specified; `name` is unique across all feeds because
  // it doubles as `news.source` and the source-health row.
  {
    url: "https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml",
    name: "sciencedaily-ai",
    field: "ai-news",
    language: "en",
  },
  {
    url: "https://www.sciencedaily.com/rss/matter_energy/chemistry.xml",
    name: "sciencedaily-chemistry",
    field: "chemistry",
    language: "en",
  },
  {
    url: "https://www.quantamagazine.org/feed/",
    name: "quanta",
    field: "multidisciplinary",
    language: "en",
  },
  {
    url: "https://www.genengnews.com/feed/",
    name: "genengnews",
    field: "biology",
    language: "en",
  },
  {
    url: "https://www.labiotech.eu/feed/",
    name: "labiotech",
    field: "biology",
    language: "en",
  },
  {
    url: "https://www.drugdiscoverytrends.com/feed/",
    name: "drugdiscoverytrends",
    field: "medicine",
    language: "en",
  },
  {
    url: "https://www.nature.com/npjcompumats.rss",
    name: "npj-computational-materials",
    field: "materials",
    language: "en",
  },
  {
    url: "https://syncedreview.com/feed/",
    name: "syncedreview",
    field: "ai-news",
    language: "en",
  },
  {
    url: "https://www.marktechpost.com/feed/",
    name: "marktechpost",
    field: "ai-news",
    language: "en",
  },
  {
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    name: "techcrunch-ai",
    field: "ai-news",
    language: "en",
  },
  {
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    name: "verge-ai",
    field: "ai-news",
    language: "en",
  },
  {
    url: "https://www.kdnuggets.com/feed",
    name: "kdnuggets",
    field: "ai-news",
    language: "en",
  },
  {
    url: "https://blog.mozilla.ai/rss/",
    name: "mozilla-ai",
    field: "ai-news",
    language: "en",
  },
];

interface PubmedSummary {
  result: Record<
    string,
    { title?: string; epubdate?: string; pubdate?: string; elocationid?: string } | undefined
  >;
}

/**
 * A targeted AI search over PubMed. `name` doubles as `news.source` and as the
 * `sources`/`source_health` row, so it must stay unique across every feed.
 */
export interface PubmedQuery {
  name: string;
  /** Science direction stored on every hit of this query. */
  field: string;
  /** PubMed esearch term (raw: URL-encoded when the request is built). */
  term: string;
}

/** Customer spec: ten results per targeted query. */
export const PUBMED_RESULTS_PER_QUERY = 10;

/**
 * The old collector reduced the whole of PubMed to one journal (Lancet). These
 * three searches follow the directions the customer asked for (AI in drug
 * discovery, genomics/proteomics, medical imaging) across every journal, which
 * is what the «ИИ для науки» section actually needs. Each term was probed via
 * esearch (HTTP 200, >1000 hits) before being configured.
 */
export const PUBMED_QUERIES: PubmedQuery[] = [
  {
    name: "pubmed-ai-drug-discovery",
    field: "medicine",
    term: '("artificial intelligence" OR "machine learning" OR "deep learning") AND (drug discovery OR pharmacology)',
  },
  {
    name: "pubmed-ai-genomics",
    field: "medicine",
    term: '("artificial intelligence" OR "deep learning") AND (genomics OR proteomics)',
  },
  {
    name: "pubmed-ai-imaging",
    field: "medicine",
    term: '("artificial intelligence") AND (medical imaging OR radiology)',
  },
];

/** NCBI allows ~3 requests/s without an API key; esearch+esummary is one pair. */
const PUBMED_THROTTLE_MS = 400;

/**
 * esearch URL for one targeted query (JSON, 10 results).
 *
 * No `sort` parameter on purpose: esearch's default order is "most recent"
 * (newly indexed records), while `sort=pub+date` orders by the journal issue
 * date. Broad queries span thousands of journals, many of which schedule
 * issues months ahead, so `pub date` sorting returned only "2027 Apr"-style
 * records whose dates the fail-closed 72h Time Guard rejects. Probed both
 * ways: the default returned 11/30 hits inside the 72h window, `pub date`
 * returned 0.
 */
export function pubmedSearchUrl(term: string): string {
  const params = new URLSearchParams({
    db: "pubmed",
    term,
    retmax: String(PUBMED_RESULTS_PER_QUERY),
    retmode: "json",
  });
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
}

const PUBMED_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** PubMed date strings are date-only: "2026 Nov 14", "2026 Nov", "2026". */
const PUBMED_DATE_RE = /^(\d{4})(?: ([A-Z][a-z]{2}))?(?: (\d{1,2}))?$/;

/**
 * Published date of a PubMed record.
 *
 * `epubdate` (the online-first date) wins over `pubdate`: PubMed stores the
 * print/issue date in `pubdate`, and journals schedule issues months ahead, so
 * a record indexed today can carry "2027 Apr". The fail-closed 72h Time Guard
 * rejects any date in the future, which is why reading `pubdate` alone used to
 * discard nearly every hit of a broad query. Ranges ("2026 Jan-Dec") are not a
 * date and are rejected instead of being guessed: no date means the Time Guard
 * cannot verify freshness.
 */
export function pubmedPublishedAt(rec: {
  epubdate?: string | null;
  pubdate?: string | null;
}): Date | null {
  for (const raw of [rec.epubdate, rec.pubdate]) {
    const text = (raw ?? "").trim();
    const match = PUBMED_DATE_RE.exec(text);
    if (!match) continue;
    let month = 0;
    if (match[2]) {
      month = PUBMED_MONTHS[match[2].toLowerCase()];
      if (month === undefined) continue;
    }
    const day = match[3] ? Number(match[3]) : 1;
    const date = new Date(Date.UTC(Number(match[1]), month, day));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Targeted AI searches via NCBI PubMed eutils (esearch + esummary).
 * Replaces the per-journal Lancet search: journal-restricted queries see one
 * outlet, while the topics the customer filters by span all of PubMed.
 */
async function collectPubmed(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (let i = 0; i < PUBMED_QUERIES.length; i++) {
    const query = PUBMED_QUERIES[i];
    const searchUrl = pubmedSearchUrl(query.term);
    const search = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(searchUrl);
    const ids = search?.esearchresult?.idlist ?? [];
    if (ids.length === 0) {
      console.error(`[collect] ${query.name}(pubmed): 0 items (esearch empty or blocked)`);
      void recordFeedHealth(query.name, searchUrl, false, 0, "esearch empty or blocked");
      continue;
    }
    const summary = await fetchJson<PubmedSummary>(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`,
    );
    let collected = 0;
    for (const pmid of ids) {
      const rec = summary?.result?.[pmid];
      if (!rec?.title) continue;
      const publishedAt = pubmedPublishedAt(rec);
      // Fail-closed, same rule as an RSS item without a date: an undated record
      // cannot pass the Time Guard and must not be presented as fresh.
      if (!publishedAt) continue;
      const doi = rec.elocationid?.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
      out.push({
        title: rec.title.replace(/\.$/, ""),
        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        source: query.name,
        publishedAt,
        language: "en",
        isScience: true,
        scienceField: query.field,
        metrics: { origin: "pubmed-eutils", pmid, doi: doi ?? null, query: query.name },
      });
      collected++;
    }
    console.error(`[collect] ${query.name}(pubmed): ${collected} items`);
    void recordFeedHealth(
      query.name,
      searchUrl,
      summary !== null,
      collected,
      summary === null ? "esummary unreachable" : undefined,
    );
    if (i < PUBMED_QUERIES.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, PUBMED_THROTTLE_MS));
    }
  }
  return out;
}

async function collectScience(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const feed of SCIENCE_FEEDS) {
    const loaded = await loadFeedItems(feed.url);
    if (!loaded.ok) {
      const error = loaded.error ?? "feed unavailable";
      console.error(`[collect] ${feed.name}: FAILED (${error})`);
      void recordFeedHealth(feed.name, feed.url, false, 0, error);
      continue;
    }
    for (const item of loaded.items.slice(0, 15)) {
      const c = fromRssItem(item, {
        name: feed.name,
        isScience: true,
        scienceField: feed.field,
        language: feed.language,
      });
      if (!c) continue;
      // Keyword filter for arXiv category feeds: only keep items that look
      // like AI-for-science tools or discoveries. Generic AI theory papers
      // are dropped here to avoid flooding the queue.
      if (feed.inventionOnly) {
        const ctx = buildInventionContext(c.title, c.description);
        if (!classifyInvention(ctx).isInvention) {
          continue;
        }
      }
      out.push(c);
    }
    console.error(`[collect] ${feed.name}: ${loaded.items.length} items`);
    void recordFeedHealth(feed.name, feed.url, true, loaded.items.length);
  }
  out.push(...(await collectPubmed()));
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { stream, dryRun, maxAgeHours, minAgeHours } = args();
  console.error(`[collect-dual] Starting (stream=${stream}, dryRun=${dryRun}, window=${minAgeHours}h..${maxAgeHours}h)`);

  const candidates: Candidate[] = [];
  if (stream === "tech" || stream === "both") {
    candidates.push(
      ...(await collectTechBlogs()),
      ...(await collectHackerNews()),
      ...(await collectGithubTrending()),
      ...(await collectReddit()),
      ...(await collectYouTube()),
    );
  }
  if (stream === "science" || stream === "both") {
    candidates.push(...(await collectScience()));
  }

  // STRICT Time Guard: reject anything older than maxAgeHours — including
  // items with missing/unparseable dates (fail-closed). Applies uniformly to
  // RSS, GitHub, HN, Reddit and PubMed candidates BEFORE dedup/scoring.
  const fresh = candidates.filter((c) =>
    isFresh(c.publishedAt, maxAgeHours * 3600_000, minAgeHours * 3600_000),
  );
  const staleDropped = candidates.length - fresh.length;
  console.error(
    `[collect-dual] ${fresh.length}/${candidates.length} in window (${minAgeHours}h..${maxAgeHours}h, ${staleDropped} stale/no-date dropped), running dedup guard...`,
  );

  const db = getDb();

  // Pre-load science categories so we can route science candidates immediately.
  const scienceCats = await db.select().from(categories).where(eq(categories.type, "science"));
  const scienceCatBySlug = new Map(scienceCats.map((c) => [c.slug, c]));

  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  const insertedIds: number[] = [];

  for (const c of fresh) {
    try {
      const dup = await isDuplicate(c.url, c.title);
      if (dup.duplicate) {
        duplicates++;
        console.error(
          `[dedup] skip "${c.title.slice(0, 60)}" (${dup.reason}${
            dup.match ? ` ~${dup.match.similarity.toFixed(2)} vs #${dup.match.id}` : ""
          })`,
        );
        continue;
      }
      if (dryRun) {
        inserted++;
        continue;
      }
      const resolution = resolveSection({ title: c.title, description: c.description });
      let categoryId: number | null = null;
      let categorySlug: string | null = null;
      if (resolution.isScience) {
        const slug = classifyScience({
          title: c.title,
          summary: c.description ?? "",
          source: c.source,
          scienceField: resolution.scienceField,
        });
        const cat = scienceCatBySlug.get(slug);
        if (cat) {
          categoryId = cat.id;
          categorySlug = cat.slug;
        }
      }

      // Unified three-way routing (single source of truth, see section-resolve).
      // Later stages re-run it with richer text and may move the article.

      const rows = await db
        .insert(news)
        .values(buildNewsRow(c, resolution, { categoryId, categorySlug }))
        .returning({ id: news.id });
      inserted++;
      insertedIds.push(rows[0].id);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("duplicate") || msg.includes("unique")) {
        duplicates++;
      } else {
        errors++;
        console.error(`[collect-dual] insert error: ${msg.slice(0, 120)}`);
      }
    }
  }

  const stats = {
    status: "ok",
    stream,
    window: { minAgeHours, maxAgeHours },
    raw: candidates.length,
    fresh: fresh.length,
    staleDropped,
    inserted,
    duplicates,
    errors,
    insertedIds: insertedIds.slice(0, 50),
  };
  console.log(JSON.stringify(stats));
  console.error(
    `[collect-dual] Done: ${inserted} inserted, ${duplicates} duplicates blocked, ${errors} errors`,
  );
  process.exit(0);
}

// Only auto-run when executed directly (npx tsx .../collect-dual.ts).
// Importing this module (e.g. from vitest) must not start a collection cycle.
const invokedDirectly = (process.argv[1] ?? "").endsWith("collect-dual.ts");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[collect-dual] Fatal error:", err);
    process.exit(1);
  });
}

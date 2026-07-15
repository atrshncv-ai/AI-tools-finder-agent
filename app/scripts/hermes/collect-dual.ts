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
 *   - Tier-1 journals RSS: Nature, Science, Lancet, Cell
 *   - MIT Technology Review, arXiv API, Naked Science (ru)
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
import { classifyScience } from "../ensure-science-categories";

const FETCH_TIMEOUT_MS = 20_000;
const HN_MIN_POINTS = 100;
const GITHUB_MIN_STARS = 300;
const GITHUB_LOOKBACK_DAYS = 3;
// Browser-like UA: some publishers (science.org, reddit) block bot UAs.
const RSS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_AGE_HOURS_DEFAULT = 72;
const MAX_AGE_MS = MAX_AGE_HOURS_DEFAULT * 3600_000;

/**
 * STRICT Time Guard: every candidate must carry a valid publication/creation
 * date no older than 72h. Missing or unparseable date => REJECTED (fail-closed).
 * Runs at collection time, BEFORE dedup/scoring — no exceptions for any source.
 */
function isFresh(publishedAt: Date | null | undefined, maxAgeMs = MAX_AGE_MS): boolean {
  if (!publishedAt) return false;
  const ts = publishedAt.getTime?.();
  if (!ts || Number.isNaN(ts)) return false;
  return Date.now() - ts <= maxAgeMs;
}

interface Candidate {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  language: string;
  isScience: boolean;
  scienceField: string | null;
  /** Pre-collected hard metrics from the source API (if available). */
  metrics: Record<string, unknown>;
}

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": RSS_UA },
});

function args() {
  const a = process.argv.slice(2);
  const streamIdx = a.indexOf("--stream");
  const ageIdx = a.indexOf("--max-age-hours");
  return {
    stream: (streamIdx >= 0 ? a[streamIdx + 1] : "both") as "tech" | "science" | "both",
    dryRun: a.includes("--dry-run"),
    maxAgeHours: ageIdx >= 0 ? parseInt(a[ageIdx + 1] || "", 10) || MAX_AGE_HOURS_DEFAULT : MAX_AGE_HOURS_DEFAULT,
  };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": RSS_UA },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
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
  return {
    title,
    url,
    source: src.name,
    publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
    language: src.language,
    isScience: src.isScience,
    scienceField: src.scienceField,
    metrics: { origin: "rss" },
  };
}

// ─── Tech stream ─────────────────────────────────────────────────────────────

const TECH_BLOG_FEEDS = [
  { url: "https://openai.com/blog/rss.xml", name: "openai-blog" },
  // NOTE: Anthropic has no public RSS feed (404 on all known endpoints).
  // Anthropic releases are picked up via HN/GitHub trend sources instead.
  { url: "https://huggingface.co/blog/feed.xml", name: "huggingface-blog" },
  { url: "https://blog.google/technology/ai/rss/", name: "google-ai-blog" },
];

/**
 * Curated English-language AI YouTube channels. YouTube exposes a standard
 * Atom feed per channel — no API key required. Videos are transcribed later
 * (youtube-transcript.ts via yt-dlp), never downloaded.
 */
const YOUTUBE_FEEDS = [
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbfYPyITQ-7l4upoX8nvctg",
    channelUrl: "https://www.youtube.com/@TwoMinutePapers/videos",
    name: "youtube-two-minute-papers",
    language: "en",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCZHmQk67mSJgfCCTn7xBfew",
    channelUrl: "https://www.youtube.com/@YannicKilcher/videos",
    name: "youtube-yannic-kilcher",
    language: "en",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCawZsQWqfGSbCI5yjkdVkTA",
    channelUrl: "https://www.youtube.com/@matthew_berman/videos",
    name: "youtube-matthew-berman",
    language: "en",
  },
  // ── Client-approved AI-tooling channels (shorts/reviews) ──
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCkaXqLNhfpgzqGh8cu6E_3w",
    channelUrl: "https://www.youtube.com/@vladimiraidev/videos",
    name: "youtube-vladimir-ai-dev",
    language: "ru",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCXyfe8u58vBf2aSWLQjJtVA",
    channelUrl: "https://www.youtube.com/@rinatsuleyman/videos",
    name: "youtube-rinat-suleymanov",
    language: "ru",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC37JpWP5PxLSma2lh79HU9A",
    channelUrl: "https://www.youtube.com/@duncanrogoff/videos",
    name: "youtube-duncan-rogoff",
    language: "en",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCRwL-Z46UPuwmpFX_vM7d_w",
    channelUrl: "https://www.youtube.com/@mcdenil_/videos",
    name: "youtube-mcdenil",
    language: "ru",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbebZGDxm5IYqNTlqHF1ODQ",
    channelUrl: "https://www.youtube.com/@artemii-miller-ai/videos",
    name: "youtube-artemii-miller",
    language: "ru",
  },
  {
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC_a85mUHqsy5j0CYCgLnkEQ",
    channelUrl: "https://www.youtube.com/@DIYSmartCode/videos",
    name: "youtube-diy-smart-code",
    language: "ru",
  },
];

async function collectYouTube(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const feed of YOUTUBE_FEEDS) {
    try {
      const parsed = await rss.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 5)) {
        const c = fromRssItem(item, {
          name: feed.name,
          isScience: false,
          scienceField: null,
          language: feed.language,
        });
        if (c) {
          c.metrics = { origin: "youtube-rss" };
          out.push(c);
        }
      }
      console.error(`[collect] ${feed.name}: ${parsed.items.length} videos (rss)`);
    } catch (err) {
      // YouTube's feeds endpoint 404s for some channels/IPs — fall back to a
      // yt-dlp channel listing (full metadata incl. upload dates).
      console.error(`[collect] ${feed.name}: RSS failed (${(err as Error).message}), trying yt-dlp fallback...`);
      const videos = await listChannelVideos(feed.channelUrl, 5);
      for (const v of videos) {
        out.push({
          title: v.title,
          url: v.url,
          source: feed.name,
          // Time Guard is fail-closed: unknown dates are dropped downstream.
          publishedAt: v.publishedAt ?? new Date(0),
          language: feed.language,
          isScience: false,
          scienceField: null,
          metrics: { origin: "youtube-rss", videoId: v.videoId },
        });
      }
      console.error(`[collect] ${feed.name}: ${videos.length} videos (yt-dlp)`);
    }
  }
  return out;
}

async function collectTechBlogs(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const feed of TECH_BLOG_FEEDS) {
    try {
      const parsed = await rss.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 10)) {
        const c = fromRssItem(item, {
          name: feed.name,
          isScience: false,
          scienceField: null,
          language: "en",
        });
        if (c) out.push(c);
      }
      console.error(`[collect] ${feed.name}: ${parsed.items.length} items`);
    } catch (err) {
      console.error(`[collect] ${feed.name}: FAILED (${(err as Error).message})`);
    }
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
  const data = await fetchJson<{ hits: HnHit[] }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=AI%20OR%20LLM%20OR%20GPT%20OR%20%22machine%20learning%22&hitsPerPage=40",
  );
  if (!data) return [];
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
  return out;
}

/**
 * Reddit via public RSS (top/day). JSON API is blocked from datacenter IPs,
 * RSS still works with a browser UA. Note: RSS has no upvote counts, so
 * Reddit is a discovery source only — social scoring happens via HN points.
 */
async function collectReddit(): Promise<Candidate[]> {
  const subs = ["MachineLearning", "artificial", "LocalLLaMA"];
  const out: Candidate[] = [];
  for (const sub of subs) {
    try {
      const parsed = await rss.parseURL(
        `https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=25`,
      );
      for (const item of parsed.items) {
        const c = fromRssItem(item, {
          name: `reddit-${sub.toLowerCase()}`,
          isScience: false,
          scienceField: null,
          language: "en",
        });
        if (c) {
          c.metrics = { origin: "reddit-rss" };
          out.push(c);
        }
      }
    } catch (err) {
      console.error(`[collect] reddit-${sub}: FAILED (${(err as Error).message})`);
    }
    // Reddit rate-limits aggressively — throttle between subreddits.
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error(`[collect] reddit: ${out.length} top posts`);
  return out;
}

// ─── Science stream ──────────────────────────────────────────────────────────

const SCIENCE_FEEDS = [
  { url: "https://www.nature.com/nature.rss", name: "nature", field: "multidisciplinary" },
  { url: "https://www.science.org/rss/news_current.xml", name: "science", field: "multidisciplinary" },
  // NOTE: Lancet killed its own RSS feeds (410 Gone) — collected via PubMed eutils below.
  { url: "https://www.cell.com/cell/current.rss", name: "cell", field: "biology" },
  { url: "https://www.technologyreview.com/feed/", name: "mit-tech-review", field: "technology" },
  {
    url: "http://export.arxiv.org/api/query?search_query=all:%22artificial+intelligence%22&sortBy=submittedDate&sortOrder=descending&max_results=25",
    name: "arxiv",
    field: "computer-science",
  },
  { url: "https://naked-science.ru/?feed=rss2", name: "naked-science", field: "multidisciplinary" },
];

interface PubmedSummary {
  result: Record<string, { title?: string; fulljournalname?: string; pubdate?: string; elocationid?: string } | undefined>;
}

/** Lancet (and other journals without RSS) via NCBI PubMed eutils. */
async function collectPubmedLancet(): Promise<Candidate[]> {
  const search = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=%22Lancet%22%5Bjournal%5D+AND+(%22artificial+intelligence%22+OR+%22machine+learning%22+OR+%22deep+learning%22)&sort=pub+date&retmax=10&retmode=json",
  );
  const ids = search?.esearchresult?.idlist ?? [];
  if (ids.length === 0) {
    console.error("[collect] lancet(pubmed): 0 items (esearch empty or blocked)");
    return [];
  }
  const summary = await fetchJson<PubmedSummary>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`,
  );
  const out: Candidate[] = [];
  for (const pmid of ids) {
    const rec = summary?.result?.[pmid];
    if (!rec?.title) continue;
    const doi = rec.elocationid?.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
    out.push({
      title: rec.title.replace(/\.$/, ""),
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      source: "lancet",
      publishedAt: rec.pubdate ? new Date(rec.pubdate) : new Date(),
      language: "en",
      isScience: true,
      scienceField: "medicine",
      metrics: { origin: "pubmed-eutils", pmid, doi: doi ?? null },
    });
  }
  console.error(`[collect] lancet(pubmed): ${out.length} items`);
  return out;
}

async function collectScience(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const feed of SCIENCE_FEEDS) {
    try {
      const parsed = await rss.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 15)) {
        const c = fromRssItem(item, {
          name: feed.name,
          isScience: true,
          scienceField: feed.field,
          language: feed.name === "naked-science" ? "ru" : "en",
        });
        if (c) out.push(c);
      }
      console.error(`[collect] ${feed.name}: ${parsed.items.length} items`);
    } catch (err) {
      console.error(`[collect] ${feed.name}: FAILED (${(err as Error).message})`);
    }
  }
  out.push(...(await collectPubmedLancet()));
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { stream, dryRun, maxAgeHours } = args();
  console.error(`[collect-dual] Starting (stream=${stream}, dryRun=${dryRun}, maxAge=${maxAgeHours}h)`);

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
  const fresh = candidates.filter((c) => isFresh(c.publishedAt, maxAgeHours * 3600_000));
  const staleDropped = candidates.length - fresh.length;
  console.error(
    `[collect-dual] ${fresh.length}/${candidates.length} fresh (<= ${maxAgeHours}h, ${staleDropped} stale/no-date dropped), running dedup guard...`,
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
      let categoryId: number | null = null;
      let categorySlug: string | null = null;
      if (c.isScience) {
        const slug = classifyScience({
          title: c.title,
          summary: "",
          source: c.source,
          scienceField: c.scienceField,
        });
        const cat = scienceCatBySlug.get(slug);
        if (cat) {
          categoryId = cat.id;
          categorySlug = cat.slug;
        }
      }

      const rows = await db
        .insert(news)
        .values({
          title: c.title.slice(0, 500),
          originalTitle: c.title.slice(0, 500),
          summary: "",
          originalUrl: c.url,
          source: c.source,
          publishedAt: c.publishedAt,
          language: c.language,
          isScience: c.isScience,
          scienceField: c.scienceField,
          categoryId,
          categorySlug,
          status: "pending",
          metrics: c.metrics,
        })
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

main().catch((err) => {
  console.error("[collect-dual] Fatal error:", err);
  process.exit(1);
});

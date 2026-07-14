import * as cheerio from "cheerio";
import { franc } from "franc-min";
import Parser from "rss-parser";
import { getDb } from "../queries/connection";
import { news, sources } from "@db/schema";
import { eq } from "drizzle-orm";
import { getAgentState, updateAgentState, getSourceHealth, shouldSkipSource, getSourcePriority } from "./state";
import { getAdaptiveSelectors } from "./sourceMonitor";
import { createParsingLog, updateParsingLog } from "../queries/parsingLogs";
import { logger } from "../lib/logger";
import { classifyArticle } from "../lib/classify";
import type { ParseDecision, ParseResult } from "./types";

const AI_KEYWORDS = [
  "artificial intelligence", "ai", "нейросеть", "нейронная сеть",
  "large language model", "llm", "большая языковая модель",
  "deep learning", "глубокое обучение", "machine learning", "машинное обучение",
  "gpt", "claude", "llama", "gemini", "gemma", "transformer", "трансформер",
  "ai agent", "ии-агент", "generative ai", "генеративный ии",
  "chatbot", "чат-бот", "openai", "anthropic", "google deepmind",
  "meta ai", "mistral", "нейросетевой", "обучение с подкреплением",
];

const USER_AGENT = "Mozilla/5.0 (compatible; ScienceAgent/1.0; +https://science-agent.ru/bot)";
const REQUEST_DELAY_MS = 1500;

export function containsAiKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((kw) => lower.includes(kw));
}

const LANG_MAP: Record<string, string> = {
  rus: "ru",
  eng: "en",
  deu: "de",
  spa: "es",
  zho: "zh",
  jpn: "ja",
  fra: "fr",
  ita: "it",
  por: "pt",
  kor: "ko",
  nld: "nl",
  pol: "pl",
  tur: "tr",
  ara: "ar",
  hin: "hi",
};

export function detectLanguage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 20) return "unknown";

  try {
    const code3 = franc(trimmed);
    if (code3 === "und") return "unknown";
    return LANG_MAP[code3] || code3.slice(0, 2);
  } catch {
    return "unknown";
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common tracking params
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref"].forEach((param) => {
      u.searchParams.delete(param);
    });
    let normalized = `${u.origin}${u.pathname}`.toLowerCase();
    normalized = normalized.replace(/\/$/, ""); // trailing slash
    normalized = normalized.replace(/^https?:\/\/(www\.)?/, ""); // www
    return normalized;
  } catch {
    return url.toLowerCase().trim();
  }
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

export function titleSimilarity(a: string, b: string): number {
  const cleanA = a.toLowerCase().trim();
  const cleanB = b.toLowerCase().trim();
  if (cleanA === cleanB) return 1;
  const maxLen = Math.max(cleanA.length, cleanB.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(cleanA, cleanB);
  return 1 - distance / maxLen;
}

const SIMILARITY_THRESHOLD = 0.85;

const domainLastRequest = new Map<string, number>();

async function throttleRequest(url: string): Promise<void> {
  try {
    const domain = new URL(url).hostname;
    const last = domainLastRequest.get(domain) || 0;
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed < REQUEST_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
    }
    domainLastRequest.set(domain, Date.now());
  } catch {
    // ignore malformed URLs
  }
}

const rssParser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": USER_AGENT },
});

async function fetchRssFeed(feedUrl: string): Promise<{ title: string; url: string; description: string; pubDate: string; imageUrl: string | null }[]> {
  await throttleRequest(feedUrl);
  try {
    const feed = await rssParser.parseURL(feedUrl);
    return feed.items.map((item) => ({
      title: item.title?.trim() || "",
      url: item.link || "",
      description: item.contentSnippet?.trim() || item.content?.trim() || "",
      pubDate: item.pubDate || item.isoDate || "",
      imageUrl: item.enclosure?.url || item.itunes?.image || null,
    }));
  } catch (e) {
    logger.error("RSS fetch error", { error: String(e) });
    return [];
  }
}

function extractPublishedAt($: cheerio.CheerioAPI): string {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="datePublished"]',
    'meta[itemprop="datePublished"]',
    'meta[name="pubdate"]',
    'meta[name="PublishDate"]',
    'time[datetime]',
    'article time[datetime]',
  ];

  for (const selector of selectors) {
    const el = $(selector).first();
    const value = el.attr("content") || el.attr("datetime");
    if (value) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }

  return "";
}

async function resolveGoogleNewsUrl(googleUrl: string): Promise<string> {
  await throttleRequest(googleUrl);
  try {
    const res = await fetch(googleUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    const finalUrl = res.url;
    if (finalUrl && finalUrl.startsWith("http")) {
      return finalUrl;
    }
  } catch (e) {
    logger.warn("Google News URL resolution failed", { url: googleUrl, error: String(e) });
  }
  return googleUrl;
}

async function fetchGoogleNews(feedUrl: string): Promise<{ title: string; url: string; description: string; pubDate: string; imageUrl: string | null }[]> {
  await throttleRequest(feedUrl);
  try {
    const feed = await rssParser.parseURL(feedUrl);
    const articles = await Promise.all(
      feed.items.map(async (item) => ({
        title: item.title?.trim() || "",
        url: await resolveGoogleNewsUrl(item.link || ""),
        description: item.contentSnippet?.trim() || item.content?.trim() || "",
        pubDate: item.pubDate || item.isoDate || "",
        imageUrl: item.enclosure?.url || null,
      }))
    );
    return articles;
  } catch (e) {
    logger.error("Google News fetch error", { error: String(e) });
    return [];
  }
}

async function fetchHtmlPage(url: string, selector: string): Promise<{ title: string; url: string; description: string; pubDate: string; imageUrl: string | null }[]> {
  await throttleRequest(url);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "";
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    const charset = charsetMatch?.[1]?.toLowerCase() || "utf-8";
    const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
    const html = decoder.decode(buffer);
    const $ = cheerio.load(html);
    const articles: { title: string; url: string; description: string; pubDate: string; imageUrl: string | null }[] = [];
    $(selector).each((_, el) => {
      const titleEl = $(el).find("h1, h2, h3, a").first();
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || $(el).find("a").first().attr("href") || "";
      const desc = $(el).find("p, .description, .summary").first().text().trim();
      const img = $(el).find("img").first().attr("src") || null;
      if (title && title.length > 10) {
        let fullUrl = link;
        if (link && !link.startsWith("http")) {
          const base = new URL(url);
          fullUrl = `${base.origin}${link.startsWith("/") ? "" : "/"}${link}`;
        }
        const pubDate = extractPublishedAt($);
        articles.push({ title, url: fullUrl, description: desc, pubDate, imageUrl: img });
      }
    });
    return articles;
  } catch (e) {
    logger.error("HTML fetch error", { url, error: String(e) });
    return [];
  }
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === "object" && acc !== null) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

async function fetchApiArticles(source: { id: number; name: string; url: string; config: unknown }): Promise<{ title: string; url: string; description: string; pubDate: string; imageUrl: string | null }[]> {
  await throttleRequest(source.url);
  const config = (source.config as Record<string, unknown>) || {};
  const apiUrl = (config.apiUrl as string) || source.url;

  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      logger.error("API fetch error", { source: source.name, status: res.status });
      return [];
    }
    const json = (await res.json()) as unknown;
    const articlesPath = (config.articlesPath as string) || "articles";
    const items = getPath(json, articlesPath) as unknown[] | undefined;
    if (!Array.isArray(items)) {
      logger.warn("API response did not contain expected articles array", { source: source.name });
      return [];
    }

    const titlePath = (config.titlePath as string) || "title";
    const urlPath = (config.urlPath as string) || "url";
    const descriptionPath = (config.descriptionPath as string) || "description";
    const publishedAtPath = (config.publishedAtPath as string) || "publishedAt";
    const imageUrlPath = (config.imageUrlPath as string) || "imageUrl";

    return items.map((item) => ({
      title: String(getPath(item, titlePath) || "").trim(),
      url: String(getPath(item, urlPath) || "").trim(),
      description: String(getPath(item, descriptionPath) || "").trim(),
      pubDate: String(getPath(item, publishedAtPath) || "").trim(),
      imageUrl: String(getPath(item, imageUrlPath) || "").trim() || null,
    }));
  } catch (e) {
    logger.error("API parse error", { source: source.name, error: String(e) });
    return [];
  }
}

export function makeDecisions(sourceList: { id: number; name: string; enabled: boolean }[]): ParseDecision[] {
  const decisions: ParseDecision[] = [];

  for (const source of sourceList) {
    if (!source.enabled) continue;
    if (shouldSkipSource(source.id)) {
      logger.info("Parse Agent: skipping source (too many failures)", { source: source.name });
      continue;
    }

    const priority = getSourcePriority(source.id);
    const health = getSourceHealth(source.id);

    let maxArticles = 50;
    if (priority === "low") maxArticles = 10;
    if (health.consecutiveFails > 0) maxArticles = 20;

    decisions.push({
      sourceId: source.id,
      sourceName: source.name,
      reason: health.consecutiveFails > 0
        ? `Recovering from ${health.consecutiveFails} failures`
        : "Scheduled parse",
      priority,
      maxArticles,
    });
  }

  decisions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  return decisions;
}

async function parseSource(
  source: { id: number; name: string; url: string; type: string; config: unknown },
  maxArticles: number
): Promise<{ title: string; url: string; description: string; pubDate?: string; imageUrl?: string | null }[]> {
  const config = source.config as Record<string, unknown> | null;

  if (source.type === "rss" && config?.feedUrl) {
    return (await fetchRssFeed(config.feedUrl as string)).slice(0, maxArticles);
  }

  if (source.type === "google_news" && config?.feedUrl) {
    return (await fetchGoogleNews(config.feedUrl as string)).slice(0, maxArticles);
  }

  if (source.type === "api") {
    return (await fetchApiArticles(source)).slice(0, maxArticles);
  }

  if (source.type === "html") {
    const selectors = await getAdaptiveSelectors(source.id);

    for (const selector of selectors) {
      const articles = await fetchHtmlPage(source.url, selector);
      if (articles.length > 0) {
        logger.info("Parse Agent: selector works", {
          sourceId: source.id,
          selector,
          articles: articles.length,
        });
        return articles.slice(0, maxArticles);
      }
    }
  }

  return [];
}

export async function runParseAgent(
  options?: { sourceId?: number; maxArticles?: number }
): Promise<ParseResult[]> {
  const state = getAgentState("parse-agent");

  if (state.status === "running") {
    logger.warn("Parse Agent: already running, skipping");
    return [];
  }

  updateAgentState("parse-agent", {
    status: "running",
    lastRun: new Date(),
    runCount: state.runCount + 1,
  });

  const results: ParseResult[] = [];

  try {
    const db = getDb();
    const allSources = await db.select().from(sources).where(eq(sources.enabled, true));

    // Single-source mode is used by the linear worker to avoid overloading the queue.
    if (options?.sourceId) {
      const source = allSources.find((s) => s.id === options.sourceId);
      if (source) {
        const maxArticles = options.maxArticles ?? 1;
        const startTime = Date.now();
        const log = await createParsingLog({ sourceId: source.id, status: "running" });
        try {
          const articles = await parseSource(source, maxArticles);
          const aiArticles = articles.filter(
            (a) => containsAiKeywords(a.title) || containsAiKeywords(a.description)
          );
          const seen = new Set<string>();
          const unique = aiArticles.filter((a) => {
            const key = a.title.toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          let newCount = 0;
          for (const article of unique) {
            const existing = await db.select().from(news).where(eq(news.originalUrl, article.url)).limit(1);
            if (existing.length > 0) continue;
            newCount++;
            const pubDate = article.pubDate ? new Date(article.pubDate) : new Date();
            const classification = classifyArticle(article.title, article.description);
            await db.insert(news).values({
              title: article.title,
              summary: article.description || "Ожидает суммаризации...",
              content: null,
              originalUrl: article.url,
              source: source.name,
              categorySlug: classification.categorySlug,
              imageUrl: article.imageUrl || null,
              publishedAt: pubDate,
              isScience: classification.isScience,
              scienceField: classification.scienceField,
              classificationType: classification.classificationType,
              language: detectLanguage(`${article.title} ${article.description}`),
              status: "pending",
            });
          }

          await updateParsingLog(log.id, {
            status: "completed",
            articlesFound: articles.length,
            articlesNew: newCount,
          });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            articlesFound: articles.length,
            articlesNew: newCount,
            duration: Date.now() - startTime,
            success: true,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await updateParsingLog(log.id, { status: "failed", errorMessage: msg });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            articlesFound: 0,
            articlesNew: 0,
            duration: Date.now() - startTime,
            success: false,
            error: msg,
          });
        }
      }
      updateAgentState("parse-agent", { status: "idle" });
      return results;
    }

    const decisions = makeDecisions(allSources);
    logger.info("Parse Agent: decisions made", { count: decisions.length });
    const seenBatch: { title: string; url: string }[] = [];

    for (const decision of decisions) {
      const source = allSources.find((s) => s.id === decision.sourceId);
      if (!source) continue;

      const startTime = Date.now();
      const log = await createParsingLog({ sourceId: source.id, status: "running" });

      try {
        const articles = await parseSource(source, decision.maxArticles);

        const aiArticles = articles.filter(
          (a) => containsAiKeywords(a.title) || containsAiKeywords(a.description)
        );
        const seen = new Set<string>();
        const unique = aiArticles.filter((a) => {
          const key = a.title.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        let newCount = 0;
        for (const article of unique) {
          const normalizedUrl = normalizeUrl(article.url);
          const existing = await db.select().from(news).where(eq(news.originalUrl, article.url)).limit(1);
          if (existing.length > 0) continue;

          // Semantic deduplication against current batch
          const isDuplicateInBatch = seenBatch.some(
            (seen) =>
              normalizeUrl(seen.url) === normalizedUrl ||
              titleSimilarity(seen.title, article.title) >= SIMILARITY_THRESHOLD
          );
          if (isDuplicateInBatch) continue;

          seenBatch.push({ title: article.title, url: article.url });

          {
            newCount++;
            const pubDate = article.pubDate ? new Date(article.pubDate) : new Date();
            const classification = classifyArticle(article.title, article.description);
            await db.insert(news).values({
              title: article.title,
              summary: article.description || "Ожидает суммаризации...",
              content: null,
              originalUrl: article.url,
              source: source.name,
              categorySlug: classification.categorySlug,
              imageUrl: article.imageUrl || null,
              publishedAt: pubDate,
              isScience: classification.isScience,
              scienceField: classification.scienceField,
              classificationType: classification.classificationType,
              language: detectLanguage(`${article.title} ${article.description}`),
              status: "pending",
            });
          }
        }

        const duration = Date.now() - startTime;
        await updateParsingLog(log.id, {
          status: "completed",
          articlesFound: articles.length,
          articlesNew: newCount,
        });

        const state = getAgentState("parse-agent");
        updateAgentState("parse-agent", { successCount: state.successCount + 1 });

        results.push({
          sourceId: source.id,
          sourceName: source.name,
          articlesFound: articles.length,
          articlesNew: newCount,
          duration,
          success: true,
        });

        logger.info("Parse Agent: source parsed", {
          source: source.name,
          found: articles.length,
          new: newCount,
          duration: `${duration}ms`,
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const msg = error instanceof Error ? error.message : String(error);

        await updateParsingLog(log.id, { status: "failed", errorMessage: msg });

        results.push({
          sourceId: source.id,
          sourceName: source.name,
          articlesFound: 0,
          articlesNew: 0,
          duration,
          success: false,
          error: msg,
        });

        logger.error("Parse Agent: source failed", {
          source: source.name,
          error: msg,
          duration: `${duration}ms`,
        });
      }
    }

    updateAgentState("parse-agent", { status: "idle" });
  } catch (error) {
    updateAgentState("parse-agent", {
      status: "error",
      lastError: error instanceof Error ? error.message : String(error),
    });
    logger.error("Parse Agent: fatal error", { error: String(error) });
  }

  return results;
}

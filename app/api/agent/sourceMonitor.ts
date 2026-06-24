import * as cheerio from "cheerio";
import { getDb } from "../queries/connection";
import { sources } from "@db/schema";
import { eq } from "drizzle-orm";
import { getSourceHealth, updateSourceHealth } from "./state";
import { logger } from "../lib/logger";

interface SourceCheckResult {
  sourceId: number;
  accessible: boolean;
  selectorWorks: boolean;
  responseTime: number;
  error?: string;
  articleCount: number;
}

async function checkSource(source: {
  id: number;
  name: string;
  url: string;
  type: string;
  config: unknown;
}): Promise<SourceCheckResult> {
  const start = Date.now();

  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ScienceAgent/1.0)" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return {
        sourceId: source.id,
        accessible: false,
        selectorWorks: false,
        responseTime: Date.now() - start,
        error: `HTTP ${res.status}`,
        articleCount: 0,
      };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const config = source.config as Record<string, unknown> | null;

    let selectorWorks = false;
    let articleCount = 0;

    if (source.type === "rss") {
      const items = $("item").length;
      selectorWorks = items > 0;
      articleCount = items;
    } else if (source.type === "html" && config?.selector) {
      const items = $(config.selector as string).filter((_, el) => {
        const text = $(el).text().trim();
        return text.length > 10 && text.length < 300;
      }).length;
      selectorWorks = items > 0;
      articleCount = items;
    }

    return {
      sourceId: source.id,
      accessible: true,
      selectorWorks,
      responseTime: Date.now() - start,
      articleCount,
    };
  } catch (e) {
    return {
      sourceId: source.id,
      accessible: false,
      selectorWorks: false,
      responseTime: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
      articleCount: 0,
    };
  }
}

export async function monitorSources(): Promise<void> {
  logger.info("Source Monitor: starting health check");

  const db = getDb();
  const allSources = await db.select().from(sources);

  for (const source of allSources) {
    const result = await checkSource(source);
    const health = getSourceHealth(source.id);

    const wasHealthy = health.status === "healthy";
    let newStatus: "healthy" | "degraded" | "failed" | "unknown";

    if (!result.accessible) {
      newStatus = "failed";
      health.consecutiveFails++;
    } else if (!result.selectorWorks) {
      newStatus = "degraded";
      health.consecutiveFails++;
    } else {
      newStatus = "healthy";
      health.consecutiveFails = 0;
      health.lastSuccess = new Date();
    }

    const totalChecks = health.runCount + 1;
    const totalSuccess = health.successCount + (result.accessible ? 1 : 0);

    updateSourceHealth(source.id, {
      sourceName: source.name,
      status: newStatus,
      lastCheck: new Date(),
      lastError: result.error || null,
      successRate: totalSuccess / totalChecks,
      avgResponseTime: (health.avgResponseTime * health.runCount + result.responseTime) / totalChecks,
      selectorWorks: result.selectorWorks,
      runCount: totalChecks,
      successCount: totalSuccess,
    });

    if (wasHealthy && newStatus !== "healthy") {
      logger.warn("Source degraded", {
        source: source.name,
        status: newStatus,
        error: result.error,
      });
    }
  }

  logger.info("Source Monitor: health check complete", {
    sources: allSources.length,
    healthy: allSources.filter((_, i) => getSourceHealth(allSources[i].id).status === "healthy").length,
  });
}

export async function getAdaptiveSelectors(sourceId: number): Promise<string[]> {
  const db = getDb();
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
  });

  if (!source || source.type !== "html") return [];

  const config = source.config as Record<string, unknown> | null;
  const primarySelector = (config?.selector as string) || "article";

  const fallbackSelectors = [
    primarySelector,
    "h2 a",
    "h3 a",
    "article a",
    "main a",
    "a[href*='article']",
    "a[href*='news']",
    "a[href*='post']",
  ];

  return [...new Set(fallbackSelectors)];
}

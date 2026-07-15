/**
 * check-urls.ts — Garbage Collection for published news (audit steps R-P0-4/R-P0-5).
 *
 * Iterates over every `status='published'` article and probes its `originalUrl`:
 *   - HTTP HEAD first; falls back to GET when HEAD is not allowed (405/501).
 *   - Articles whose URL is definitively dead (404/410 Gone, or DNS failure)
 *     are purged: status is set to 'rejected' (soft delete, keeps audit trail).
 *   - Ambiguous results (403 anti-bot, timeouts, 5xx, network resets) are NOT
 *     purged — the link may be alive for real users.
 *
 * Usage:
 *   npx tsx scripts/check-urls.ts            # dry-run: only report
 *   npx tsx scripts/check-urls.ts --apply    # actually reject dead articles
 */

import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;
const DELAY_MS = 400;

/** DOI pattern as it appears inside URLs (doi.org links, /doi/ paths). */
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

/**
 * Academic publishers (nature.com, science.org, ...) hide behind Cloudflare
 * anti-bot walls that 403 every datacenter probe — making direct healthchecks
 * useless. doi.org, however, answers plainly from anywhere: 3xx = DOI exists,
 * 404 = hallucinated/fake identifier. So for academic URLs we resolve the DOI
 * instead of probing the publisher page.
 *
 * Nature article URLs carry the DOI suffix in the slug:
 *   nature.com/articles/s41586-024-07819-6  ->  doi.org/10.1038/s41586-024-07819-6
 */
function extractDoi(url: string): string | null {
  const direct = url.match(DOI_RE);
  if (direct) return direct[0].replace(/[.)]+$/, "");
  if (/\bnature\.com\//i.test(url)) {
    const slug = url.match(/\/articles\/([A-Za-z0-9-]+)/)?.[1];
    if (slug && /^s\d{5}-/.test(slug)) return `10.1038/${slug}`;
  }
  return null;
}

/** Probe via the DOI resolver (no redirect following — publisher walls beyond). */
async function probeDoi(doi: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`https://doi.org/${doi}`, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return { kind: "dead", reason: `DOI 10.… not found (doi.org 404)` };
    if (res.status >= 200 && res.status < 400) return { kind: "alive", status: res.status };
    return { kind: "unknown", reason: `doi.org HTTP ${res.status}` };
  } catch (err) {
    return { kind: "unknown", reason: `doi.org fetch error: ${String(err).slice(0, 80)}` };
  }
}

type ProbeResult =
  | { kind: "alive"; status: number }
  | { kind: "dead"; reason: string }
  | { kind: "unknown"; reason: string };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyHttp(status: number): ProbeResult {
  if (status === 404 || status === 410) {
    return { kind: "dead", reason: `HTTP ${status}` };
  }
  if (status >= 200 && status < 400) return { kind: "alive", status };
  // 401/403/429/5xx — anti-bot or server-side issue, not proof of a dead link.
  return { kind: "unknown", reason: `HTTP ${status}` };
}

async function probe(url: string): Promise<ProbeResult> {
  // Academic URLs: resolve the DOI instead of fighting the anti-bot wall.
  const doi = extractDoi(url);
  if (doi) return probeDoi(doi);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = String((err as Error).message || err);
    const cause = String((err as { cause?: { code?: string } })?.cause?.code || "");
    // DNS failure = domain does not exist → definitively dead.
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg + cause)) {
      return { kind: "dead", reason: `DNS error (${cause || "ENOTFOUND"})` };
    }
    return { kind: "unknown", reason: `fetch error: ${msg.slice(0, 80)}` };
  }

  // Some servers reject HEAD — retry with GET before judging.
  if (res.status === 405 || res.status === 501) {
    try {
      const get = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      // Drain a tiny slice so the connection can close cleanly.
      await get.arrayBuffer().then((b) => b.slice(0, 0)).catch(() => {});
      return classifyHttp(get.status);
    } catch (err) {
      return { kind: "unknown", reason: `GET fallback error: ${String(err).slice(0, 80)}` };
    }
  }

  return classifyHttp(res.status);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  const articles = await db
    .select({ id: news.id, title: news.title, originalUrl: news.originalUrl, source: news.source })
    .from(news)
    .where(eq(news.status, "published"));

  console.error(`[check-urls] Probing ${articles.length} published articles (${apply ? "APPLY" : "DRY-RUN"} mode)...`);

  let alive = 0;
  let dead = 0;
  let unknown = 0;
  const deadList: { id: number; url: string; reason: string }[] = [];

  for (const a of articles) {
    const result = await probe(a.originalUrl);
    if (result.kind === "alive") {
      alive++;
    } else if (result.kind === "dead") {
      dead++;
      deadList.push({ id: a.id, url: a.originalUrl, reason: result.reason });
      console.error(`[dead]    #${a.id} ${a.originalUrl} — ${result.reason} — "${a.title.slice(0, 60)}"`);
      if (apply) {
        await db
          .update(news)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(news.id, a.id));
      }
    } else {
      unknown++;
      console.error(`[unknown] #${a.id} ${a.originalUrl} — ${result.reason}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(
    JSON.stringify({
      status: "ok",
      mode: apply ? "apply" : "dry-run",
      total: articles.length,
      alive,
      dead,
      rejected: apply ? dead : 0,
      unknown,
      deadUrls: deadList,
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[check-urls] Fatal error:", err);
  process.exit(1);
});

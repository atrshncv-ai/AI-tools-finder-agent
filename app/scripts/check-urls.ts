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

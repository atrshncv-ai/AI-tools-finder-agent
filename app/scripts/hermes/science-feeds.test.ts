import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBMED_QUERIES,
  PUBMED_RESULTS_PER_QUERY,
  SCIENCE_FEEDS,
  TECH_BLOG_FEEDS,
  loadFeedItems,
  pubmedPublishedAt,
  pubmedSearchUrl,
} from "./collect-dual";
import { COLLECTOR_UA, resetFeedThrottle } from "./feed-fetch";

/**
 * The "science" and "invention tools" sections were starving: one day brought
 * 181 materials, but only 11 landed in «Наука» and 2 in «Инструменты для
 * изобретений». The cause is that general science feeds carry few AI papers and
 * the AI gate drops the rest, so the collector needs feeds whose whole audience
 * is AI × science.
 *
 * Every URL below was probed with curl (HTTP 200) before being configured.
 */
const NEW_AI_SCIENCE_FEEDS = [
  {
    url: "https://www.nature.com/natmachintell.rss",
    name: "nature-machine-intelligence",
    field: "science",
  },
  {
    url: "https://www.nature.com/nmeth.rss",
    name: "nature-methods",
    field: "biology",
  },
  {
    url: "https://www.cell.com/cell-systems/current.rss",
    name: "cell-systems",
    field: "biology",
  },
  {
    url: "https://www.cell.com/patterns/current.rss",
    name: "patterns",
    field: "multidisciplinary",
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=all:%22machine+learning%22+AND+cat:q-bio.BM&sortBy=submittedDate&sortOrder=descending&max_results=20",
    name: "arxiv-ai-q-bio-bm",
    field: "biology",
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=all:%22deep+learning%22+AND+cat:cond-mat.mtrl-sci&sortBy=submittedDate&sortOrder=descending&max_results=20",
    name: "arxiv-ai-mtrl-sci",
    field: "materials",
  },
] as const;

/** The three targeted PubMed searches that replace the single Lancet query. */
const EXPECTED_PUBMED_TERMS = [
  '("artificial intelligence" OR "machine learning" OR "deep learning") AND (drug discovery OR pharmacology)',
  '("artificial intelligence" OR "deep learning") AND (genomics OR proteomics)',
  '("artificial intelligence") AND (medical imaging OR radiology)',
] as const;

describe("AI-for-science feed configuration", () => {
  it("contains every dedicated AI-for-science feed with its customer direction", () => {
    for (const expected of NEW_AI_SCIENCE_FEEDS) {
      expect(SCIENCE_FEEDS).toEqual(
        expect.arrayContaining([expect.objectContaining({ ...expected })]),
      );
    }
  });

  it("keeps the existing science feeds instead of replacing them", () => {
    const urls = SCIENCE_FEEDS.map((feed) => feed.url);
    for (const url of [
      "https://www.nature.com/nature.rss",
      "https://www.cell.com/cell/current.rss",
      "https://www.nature.com/nbt.rss",
      "https://connect.biorxiv.org/biorxiv_xml.php?subject=all",
      "http://export.arxiv.org/api/query?search_query=cat:q-bio.BM&sortBy=submittedDate&sortOrder=descending&max_results=15",
      "http://export.arxiv.org/api/query?search_query=cat:cond-mat.mtrl-sci&sortBy=submittedDate&sortOrder=descending&max_results=15",
    ]) {
      expect(urls).toContain(url);
    }
  });

  it("gives every new AI-for-science feed a name, a field and a unique URL", () => {
    for (const expected of NEW_AI_SCIENCE_FEEDS) {
      const feed = SCIENCE_FEEDS.find((entry) => entry.name === expected.name);
      expect(feed, `missing feed ${expected.name}`).toBeDefined();
      expect(feed?.field.trim().length).toBeGreaterThan(0);
      expect(feed?.language).toBe("en");
    }
    const urls = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS].map((feed) => feed.url);
    expect(new Set(urls).size).toBe(urls.length);
    const names = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS].map((feed) => feed.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("filters the new arXiv feeds by AI instead of subscribing to a bare category", () => {
    for (const name of ["arxiv-ai-q-bio-bm", "arxiv-ai-mtrl-sci"]) {
      const feed = SCIENCE_FEEDS.find((entry) => entry.name === name);
      expect(feed, `missing feed ${name}`).toBeDefined();
      expect(feed?.url).toMatch(/search_query=all:/);
      // Query strings encode spaces as "+": decode both before matching.
      const decoded = decodeURIComponent(feed?.url ?? "").replace(/\+/g, " ");
      expect(decoded).toMatch(/"machine learning"|"deep learning"/);
      expect(decoded).toMatch(/AND cat:/);
    }
  });
});

describe("targeted PubMed queries", () => {
  it("replaces the single Lancet query with the three targeted searches", () => {
    expect(PUBMED_QUERIES.map((query) => query.term)).toEqual([...EXPECTED_PUBMED_TERMS]);
    expect(PUBMED_QUERIES.some((query) => query.term.includes("[journal]"))).toBe(false);
  });

  it("uses distinct terms and distinct source names", () => {
    const terms = PUBMED_QUERIES.map((query) => query.term.trim());
    const names = PUBMED_QUERIES.map((query) => query.name.trim());
    expect(terms.filter(Boolean)).toHaveLength(terms.length);
    expect(names.filter(Boolean)).toHaveLength(names.length);
    expect(new Set(terms).size).toBe(terms.length);
    expect(new Set(names).size).toBe(names.length);
    const feedNames = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS].map((feed) => feed.name);
    for (const name of names) expect(feedNames).not.toContain(name);
  });

  it("tags every query with the medicine direction", () => {
    for (const query of PUBMED_QUERIES) {
      expect(query.field).toBe("medicine");
    }
  });

  it("requests 10 results per query through the esearch JSON endpoint", () => {
    expect(PUBMED_RESULTS_PER_QUERY).toBe(10);
    for (const query of PUBMED_QUERIES) {
      const url = new URL(pubmedSearchUrl(query.term));
      expect(url.host).toBe("eutils.ncbi.nlm.nih.gov");
      expect(url.pathname).toContain("esearch.fcgi");
      expect(url.searchParams.get("db")).toBe("pubmed");
      expect(url.searchParams.get("retmax")).toBe("10");
      expect(url.searchParams.get("retmode")).toBe("json");
      expect(url.searchParams.get("term")).toBe(query.term);
      // Sorting by journal issue date returned only future-dated issues that
      // the fail-closed 72h Time Guard drops; the default "most recent" order
      // is what actually yields fresh records.
      expect(url.searchParams.has("sort")).toBe(false);
    }
  });
});

/**
 * The collector no longer calls rss-parser's own downloader: every feed goes
 * through feed-fetch.ts (UA ladder, Accept header, one retry, per-host pacing)
 * and is parsed from the text it returns. A broken feed must never throw out of
 * the loop — the next source still has to be collected.
 */
const FEED_XML =
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
  `<title>Cell Systems</title><link>https://example.com</link><description>d</description>` +
  `<item><title>Foundation model predicts protein interactions</title>` +
  `<link>https://example.com/protein-model</link>` +
  `<pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate>` +
  `<description>A multimodal model for protein complexes.</description></item></channel></rss>`;

function reply(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  resetFeedThrottle();
});

describe("resilient feed loading", () => {
  it("parses items after the collector UA is refused and the browser UA is accepted", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const ua = new Headers(init?.headers).get("user-agent");
      return ua === COLLECTOR_UA ? reply(403) : reply(200, FEED_XML);
    });

    const loaded = await loadFeedItems("https://www.cell.com/cell-systems/current.rss", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
      log: () => {},
    });

    expect(loaded.ok).toBe(true);
    expect(loaded.strategy).toBe("browser-ua");
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].title).toBe("Foundation model predicts protein interactions");
    expect(loaded.items[0].link).toBe("https://example.com/protein-model");
  });

  it("returns a skip result instead of throwing when every attempt is rejected", async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => reply(403, "BLOCK-PAGE-BODY"));

    const loaded = await loadFeedItems("https://www.nature.com/nchem.rss", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
      log: (message: string) => logs.push(message),
    });

    expect(loaded.ok).toBe(false);
    expect(loaded.items).toEqual([]);
    expect(loaded.error).toMatch(/403/);
    expect(logs.join("\n")).not.toContain("BLOCK-PAGE-BODY");
  });

  it("reports a non-XML answer as a skipped feed, not a crash", async () => {
    const fetchImpl = vi.fn(async () => reply(200, "<!doctype html><html><body>blocked</body></html>"));

    const loaded = await loadFeedItems("https://deepmind.google/blog/rss.xml", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
      log: () => {},
    });

    expect(loaded.ok).toBe(false);
    expect(loaded.items).toEqual([]);
    expect(loaded.error).toBeTruthy();
  });
});

describe("broken DeepMind feed", () => {
  it("is not configured: the URL answers with a non-XML page", () => {
    expect(TECH_BLOG_FEEDS.map((feed) => feed.name)).not.toContain("deepmind-blog");
    expect(TECH_BLOG_FEEDS.map((feed) => feed.url)).not.toContain(
      "https://deepmind.google/blog/rss.xml",
    );
  });
});

describe("PubMed publication dates", () => {
  it("prefers the online date so future issue dates do not trip the 72h Time Guard", () => {
    const published = pubmedPublishedAt({ epubdate: "2026 Nov 14", pubdate: "2027 Apr" });
    expect(published?.toISOString().slice(0, 10)).toBe("2026-11-14");
  });

  it("falls back to the print date when no online date is available", () => {
    const published = pubmedPublishedAt({ pubdate: "2026 Nov 12" });
    expect(published?.toISOString().slice(0, 10)).toBe("2026-11-12");
  });

  it("rejects unparseable ranges instead of inventing a date", () => {
    expect(pubmedPublishedAt({})).toBeNull();
    expect(pubmedPublishedAt({ pubdate: "2026 Jan-Dec" })).toBeNull();
    expect(pubmedPublishedAt({ epubdate: "", pubdate: "Spring 2026" })).toBeNull();
  });
});

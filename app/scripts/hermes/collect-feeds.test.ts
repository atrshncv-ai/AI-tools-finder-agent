import { describe, expect, it, vi } from "vitest";
import { SCIENCE_FEEDS, TECH_BLOG_FEEDS, isFresh } from "./collect-dual";
import { matchTitle, normalizeTitle } from "./dedup";

/**
 * Approved by the customer and verified reachable: science/medicine/chemistry/
 * materials feeds plus two Russian-language sources that must carry
 * `language: "ru"` so the existing language mechanism can down-weight them.
 */
const NEW_SCIENCE_FEEDS = [
  {
    url: "https://connect.biorxiv.org/biorxiv_xml.php?subject=all",
    name: "biorxiv",
    field: "biology",
  },
  {
    url: "https://connect.medrxiv.org/medrxiv_xml.php?subject=all",
    name: "medrxiv",
    field: "medicine",
  },
  {
    url: "https://www.nature.com/nbt.rss",
    name: "nature-biotechnology",
    field: "biology",
  },
  {
    url: "https://www.nature.com/nchem.rss",
    name: "nature-chemistry",
    field: "chemistry",
  },
  {
    url: "https://www.nature.com/nmat.rss",
    name: "nature-materials",
    field: "materials",
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=cat:q-bio.BM&sortBy=submittedDate&sortOrder=descending&max_results=15",
    name: "arxiv-q-bio-bm",
    field: "biology",
  },
  {
    url: "http://export.arxiv.org/api/query?search_query=cat:cond-mat.mtrl-sci&sortBy=submittedDate&sortOrder=descending&max_results=15",
    name: "arxiv-cond-mat-mtrl-sci",
    field: "materials",
  },
  {
    url: "https://nplus1.ru/rss",
    name: "n-plus-one",
    field: "multidisciplinary",
    language: "ru",
  },
] as const;

/**
 * Owner-verified on 2026-11-15: every URL answered HTTP 200 and returned
 * records. `name` doubles as `news.source` and as the source-health row, so it
 * must stay unique; `field` is the customer direction stored with the item.
 */
const VERIFIED_RSS_SOURCES = [
  {
    name: "sciencedaily-ai",
    url: "https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml",
    field: "ai-news",
  },
  {
    name: "sciencedaily-chemistry",
    url: "https://www.sciencedaily.com/rss/matter_energy/chemistry.xml",
    field: "chemistry",
  },
  {
    name: "quanta",
    url: "https://www.quantamagazine.org/feed/",
    field: "multidisciplinary",
  },
  {
    name: "genengnews",
    url: "https://www.genengnews.com/feed/",
    field: "biology",
  },
  {
    name: "labiotech",
    url: "https://www.labiotech.eu/feed/",
    field: "biology",
  },
  {
    name: "drugdiscoverytrends",
    url: "https://www.drugdiscoverytrends.com/feed/",
    field: "medicine",
  },
  {
    name: "npj-computational-materials",
    url: "https://www.nature.com/npjcompumats.rss",
    field: "materials",
  },
  {
    name: "syncedreview",
    url: "https://syncedreview.com/feed/",
    field: "ai-news",
  },
  {
    name: "marktechpost",
    url: "https://www.marktechpost.com/feed/",
    field: "ai-news",
  },
  {
    name: "techcrunch-ai",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    field: "ai-news",
  },
  {
    name: "verge-ai",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    field: "ai-news",
  },
  {
    name: "kdnuggets",
    url: "https://www.kdnuggets.com/feed",
    field: "ai-news",
  },
  {
    name: "mozilla-ai",
    url: "https://blog.mozilla.ai/rss/",
    field: "ai-news",
  },
] as const;

const NEW_TECH_FEEDS = [
  {
    url: "https://deepmind.google/blog/rss.xml",
    name: "deepmind-blog",
  },
  {
    url: "https://habr.com/ru/rss/hub/artificial_intelligence/",
    name: "habr-ai",
    language: "ru",
  },
] as const;

describe("collector feed configuration", () => {
  it("contains every approved science feed with its customer direction", () => {
    for (const expected of NEW_SCIENCE_FEEDS) {
      expect(SCIENCE_FEEDS).toEqual(
        expect.arrayContaining([expect.objectContaining({ ...expected })]),
      );
    }
  });

  it("contains the approved AI-news feeds", () => {
    for (const expected of NEW_TECH_FEEDS) {
      expect(TECH_BLOG_FEEDS).toEqual(
        expect.arrayContaining([expect.objectContaining({ ...expected })]),
      );
    }
  });

  it("keeps every feed URL and name unique (no duplicate outlets)", () => {
    const feeds = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS];
    const urls = feeds.map((feed) => feed.url);
    const names = feeds.map((feed) => feed.name);
    expect(new Set(urls).size).toBe(urls.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every feed a name, a field and a known language", () => {
    for (const feed of [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS]) {
      expect(feed.name.trim().length).toBeGreaterThan(0);
      expect(feed.field.trim().length).toBeGreaterThan(0);
      expect(["en", "ru"]).toContain(feed.language);
    }
  });

  it("marks Russian-language sources with language ru", () => {
    const habr = TECH_BLOG_FEEDS.find((feed) => feed.name === "habr-ai");
    const nPlusOne = SCIENCE_FEEDS.find((feed) => feed.name === "n-plus-one");
    expect(habr?.language).toBe("ru");
    expect(nPlusOne?.language).toBe("ru");
  });

  it("does not re-add already configured outlets", () => {
    const urls = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS].map((feed) => feed.url);
    expect(urls.filter((url) => url === "https://www.nature.com/nature.rss")).toHaveLength(1);
    expect(urls.filter((url) => url === "https://www.cell.com/cell/current.rss")).toHaveLength(1);
    expect(urls.filter((url) => url === "https://naked-science.ru/?feed=rss2")).toHaveLength(1);
    expect(urls.filter((url) => url === "https://www.technologyreview.com/feed/")).toHaveLength(1);
  });
});

describe("owner-verified RSS sources (2026-11-15)", () => {
  it("configures all 13 feeds with the exact name/url/field and language en", () => {
    for (const expected of VERIFIED_RSS_SOURCES) {
      expect(SCIENCE_FEEDS).toEqual(
        expect.arrayContaining([expect.objectContaining({ ...expected, language: "en" })]),
      );
    }
  });

  it("keeps every verified URL and name unique across the whole collector", () => {
    const feeds = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS];
    for (const expected of VERIFIED_RSS_SOURCES) {
      expect(feeds.filter((feed) => feed.url === expected.url)).toHaveLength(1);
      expect(feeds.filter((feed) => feed.name === expected.name)).toHaveLength(1);
    }
    expect(VERIFIED_RSS_SOURCES).toHaveLength(13);
    expect(new Set(VERIFIED_RSS_SOURCES.map((feed) => feed.url)).size).toBe(13);
    expect(new Set(VERIFIED_RSS_SOURCES.map((feed) => feed.name)).size).toBe(13);
  });

  it("rejects a stale item from a verified feed at the 72h Time Guard", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));
    try {
      expect(isFresh(new Date("2026-11-15T11:00:00.000Z"))).toBe(true);
      expect(isFresh(new Date("2026-11-12T12:00:00.000Z"))).toBe(true); // exactly 72h
      expect(isFresh(new Date("2026-11-12T11:59:59.000Z"))).toBe(false);
      expect(isFresh(null)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still collapses one story republished by two verified feeds (semantic dedup)", () => {
    // Dedup keys off URL + title, not the source: adding feeds must not bypass it.
    const fromLabiotech = "AI drug discovery platform finds new antibiotic candidate";
    const fromDrugDiscoveryTrends =
      "AI drug discovery platform identifies a new antibiotic candidate";
    const match = matchTitle(
      fromDrugDiscoveryTrends,
      normalizeTitle(fromDrugDiscoveryTrends),
      fromLabiotech,
      0.85,
    );
    expect(match).not.toBeNull();
  });
});

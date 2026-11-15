import { describe, expect, it } from "vitest";
import { SCIENCE_FEEDS, TECH_BLOG_FEEDS } from "./collect-dual";

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

import { afterEach, describe, expect, it, vi } from "vitest";
import { SCIENCE_FEEDS, TECH_BLOG_FEEDS } from "./collect-dual";
import { evaluate, scienceSourceScore, sourceAuthorityPoints } from "./evaluate-news";
import { PUBLISH_SCORE_FLOOR } from "./pipeline-config";
import { SOURCE_TIER_POINTS, prefilterCandidate, sourceTier } from "./prefilter";
import { YOUTUBE_SOURCES, youtubeSourceTier } from "./youtube-sources";

/**
 * Second wave of sources, owner-verified live on 2026-11-23: every RSS URL
 * answered HTTP 200 and returned records, every channel was checked through
 * the YouTube Data API. `name` doubles as `news.source` and as the
 * source-health row, so it must stay unique across the whole collector.
 *
 * Tiers are NOT declared here: they must come from the single scale in
 * prefilter.ts (+45/+30/+15), which evaluate-news.ts reads for the score.
 */
const SECOND_WAVE_RSS = [
  { name: "medicalxpress", url: "https://medicalxpress.com/rss-feed/", field: "medicine", tier: 2 },
  { name: "techxplore", url: "https://techxplore.com/rss-feed/", field: "engineering", tier: 2 },
  {
    name: "sciencedaily-biochemistry",
    url: "https://www.sciencedaily.com/rss/matter_energy/biochemistry.xml",
    field: "biology",
    tier: 2,
  },
  {
    name: "sciencedaily-medical-imaging",
    url: "https://www.sciencedaily.com/rss/health_medicine/medical_imaging.xml",
    field: "medicine",
    tier: 2,
  },
  {
    name: "arstechnica-science",
    url: "https://arstechnica.com/science/feed/",
    field: "multidisciplinary",
    tier: 2,
  },
  { name: "futurity", url: "https://www.futurity.org/feed/", field: "multidisciplinary", tier: 3 },
  {
    name: "advancedsciencenews",
    url: "https://www.advancedsciencenews.com/feed/",
    field: "materials",
    tier: 2,
  },
  { name: "mit-news-ai", url: "https://news.mit.edu/rss/topic/artificial-intelligence2", field: "ai-news", tier: 1 },
  { name: "bair-berkeley", url: "https://bair.berkeley.edu/blog/feed.xml", field: "ai-news", tier: 2 },
  {
    name: "aws-machine-learning",
    url: "https://aws.amazon.com/blogs/machine-learning/feed/",
    field: "ai-news",
    tier: 2,
  },
  { name: "the-decoder", url: "https://the-decoder.com/feed/", field: "ai-news", tier: 3 },
  { name: "unite-ai", url: "https://www.unite.ai/feed/", field: "ai-news", tier: 3 },
  { name: "rdworldonline", url: "https://www.rdworldonline.com/feed/", field: "engineering", tier: 2 },
] as const;

/**
 * Channel IDs resolved from each public channel page (canonical link) after the
 * owner verified the handles through the YouTube Data API on 2026-11-23: both
 * collection paths key off `channelId`, not the handle.
 */
const SECOND_WAVE_CHANNELS = [
  { handle: "@nature", name: "youtube-nature", channelId: "UCvCLdSgYdSTpWcOgEJgi-ng", tier: 1 },
  { handle: "@MIT", name: "youtube-mit", channelId: "UCFe-pfe0a9bDvWy74Jd7vFg", tier: 1 },
  { handle: "@statquest", name: "youtube-statquest", channelId: "UCtYLUTtgS3k1Fg4y5tAhLbw", tier: 2 },
  {
    handle: "@sangerinstitute",
    name: "youtube-sanger-institute",
    channelId: "UC0KoEZJH__bnfKLFZ1gsk3Q",
    tier: 2,
  },
  { handle: "@nvidia", name: "youtube-nvidia", channelId: "UCHuiy8bXnmK5nisYHUd1J5g", tier: 2 },
  { handle: "@COMSOL", name: "youtube-comsol", channelId: "UCrx4DqkACEdL_cV8eDQ-_7g", tier: 3 },
] as const;

const NOW = new Date("2026-11-23T12:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("second-wave source configuration (owner-verified 2026-11-23)", () => {
  it("configures all 13 RSS sources exactly once with name, field and tier", () => {
    expect(SECOND_WAVE_RSS).toHaveLength(13);
    expect(new Set(SECOND_WAVE_RSS.map((source) => source.url)).size).toBe(13);
    expect(new Set(SECOND_WAVE_RSS.map((source) => source.name)).size).toBe(13);

    const feeds = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS];
    for (const expected of SECOND_WAVE_RSS) {
      const matches = feeds.filter(
        (feed) => feed.url === expected.url || feed.name === expected.name,
      );
      expect(matches, `expected exactly one feed for ${expected.name}`).toHaveLength(1);
      const feed = matches[0];
      expect(feed).toMatchObject({
        name: expected.name,
        url: expected.url,
        field: expected.field,
        language: "en",
      });
      expect(feed.field.trim().length).toBeGreaterThan(0);
      expect(sourceTier(feed.name)).toBe(expected.tier);
    }
  });

  it("keeps every new feed URL and name unique across the whole collector", () => {
    const feeds = [...SCIENCE_FEEDS, ...TECH_BLOG_FEEDS];
    const urls = feeds.map((feed) => feed.url);
    const names = feeds.map((feed) => feed.name);
    expect(new Set(urls).size).toBe(urls.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("configures all 6 channels exactly once as English dedicated-AI sources with a tier", () => {
    expect(SECOND_WAVE_CHANNELS).toHaveLength(6);
    expect(new Set(SECOND_WAVE_CHANNELS.map((source) => source.handle)).size).toBe(6);
    expect(new Set(SECOND_WAVE_CHANNELS.map((source) => source.channelId)).size).toBe(6);

    for (const expected of SECOND_WAVE_CHANNELS) {
      const matches = YOUTUBE_SOURCES.filter(
        (source) =>
          source.handle === expected.handle ||
          source.name === expected.name ||
          source.channelId === expected.channelId,
      );
      expect(matches, `expected exactly one channel for ${expected.handle}`).toHaveLength(1);
      const channel = matches[0];
      expect(channel).toMatchObject({
        handle: expected.handle,
        name: expected.name,
        channelId: expected.channelId,
        language: "en",
        dedicatedAi: true,
      });
      expect(channel.tabs).toContain("videos");
      expect(youtubeSourceTier(channel.name)).toBe(expected.tier);
      // The shared scale: a channel tier resolves through prefilter.sourceTier.
      expect(sourceTier(channel.name)).toBe(expected.tier);
    }
  });

  it("keeps every channel handle, name and ID unique", () => {
    const handles = YOUTUBE_SOURCES.map((source) => source.handle);
    const names = YOUTUBE_SOURCES.map((source) => source.name);
    const ids = YOUTUBE_SOURCES.map((source) => source.channelId);
    expect(new Set(handles).size).toBe(handles.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("tier weights (+45/+30/+15) for the second wave", () => {
  it("keeps one authority scale shared by prefilter and scoring", () => {
    expect(SOURCE_TIER_POINTS).toEqual({ 1: 45, 2: 30, 3: 15 });
  });

  it("scores a TIER1 RSS source above a TIER3 one, all else equal", () => {
    expect(sourceAuthorityPoints("mit-news-ai")).toBe(45);
    expect(sourceAuthorityPoints("the-decoder")).toBe(15);
    expect(sourceAuthorityPoints("mit-news-ai")).toBeGreaterThan(
      sourceAuthorityPoints("the-decoder"),
    );

    const sameElsewhere = {
      title: "AI model predicts protein interactions from sequence alone",
      lead:
        "The machine learning system reads amino-acid sequences and ranks candidate " +
        "complexes; the authors describe the neural network and its training data.",
      publishedAt: new Date(NOW.getTime() - 3600_000),
    };
    const tier1 = prefilterCandidate({ ...sameElsewhere, source: "mit-news-ai" }, { now: NOW });
    const tier3 = prefilterCandidate({ ...sameElsewhere, source: "the-decoder" }, { now: NOW });

    expect(tier1.keep && tier3.keep).toBe(true);
    expect(tier1.score).toBeGreaterThan(tier3.score);
  });

  it("scores a TIER1 channel above a TIER3 one", () => {
    expect(sourceAuthorityPoints("youtube-nature")).toBe(45);
    expect(sourceAuthorityPoints("youtube-comsol")).toBe(15);
    expect(sourceAuthorityPoints("youtube-nature")).toBeGreaterThan(
      sourceAuthorityPoints("youtube-comsol"),
    );
  });
});

describe("medicalxpress publication floor", () => {
  it("publishes an AI-signal medicalxpress material above the 35 floor", () => {
    const floorScore = scienceSourceScore("medicalxpress");
    // Tier-2 authority (30) + explicit AI×science relevance (20) = 50.
    expect(floorScore).toBe(50);
    expect(floorScore).toBeGreaterThanOrEqual(PUBLISH_SCORE_FLOOR);
  });

  it("evaluates an AI-signal medicalxpress page above the publication floor end-to-end", async () => {
    const page =
      "<html><body><article>" +
      "Artificial intelligence reads brain scans and flags early Alzheimer's changes. " +
      "The machine learning model was trained on thousands of medical imaging studies " +
      "and outperformed radiologists on the held-out test set, the researchers report." +
      "</article></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("hn.algolia.com") ? JSON.stringify({ hits: [] }) : page;
        return {
          ok: true,
          status: 200,
          text: async () => body,
          json: async () => JSON.parse(body),
        } as unknown as Response;
      }),
    );

    const result = await evaluate({
      id: 1,
      title: "AI model spots early Alzheimer's signs on MRI scans",
      lead:
        "A machine learning system trained on medical imaging data detected" +
        " neurodegenerative changes years before clinical diagnosis.",
      originalUrl: "https://medicalxpress.com/news/2026-11-ai-alzheimer-mri.html",
      source: "medicalxpress",
      isScience: true,
      metrics: {},
    });

    expect(result.breakdown).toEqual(
      expect.arrayContaining([expect.objectContaining({ criterion: "tier2-source", points: 30 })]),
    );
    expect(result.score).toBeGreaterThanOrEqual(PUBLISH_SCORE_FLOOR);
  });
});

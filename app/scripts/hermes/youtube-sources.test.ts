import { describe, expect, it } from "vitest";
import { YOUTUBE_SOURCES, youtubeSourceTier } from "./youtube-sources";

/**
 * Owner-verified via the YouTube Data API on 2026-11-15. Channel IDs were also
 * resolved from each public channel page, because the legacy Atom fallback and
 * the Data API both key off `channelId`, not the handle.
 */
const VERIFIED_CHANNELS = [
  {
    handle: "@GoogleDeepMind",
    name: "youtube-google-deepmind",
    channelId: "UCP7jMXSY2xbc3KCAE0MHQ-A",
    tier: 1,
  },
  {
    handle: "@GoogleResearch",
    name: "youtube-google-research",
    channelId: "UCT-VzthVAM_4ohDdKa-BbXA",
    tier: 1,
  },
  {
    handle: "@MicrosoftResearch",
    name: "youtube-microsoft-research",
    channelId: "UCCb9_Kn8F_Opb3UCGm-lILQ",
    tier: 1,
  },
  {
    handle: "@IBMResearch",
    name: "youtube-ibm-research",
    channelId: "UCwx7Y3W30N8aS_tiCy2x-2g",
    tier: 1,
  },
  {
    handle: "@MITCSAIL",
    name: "youtube-mit-csail",
    channelId: "UCBpxspUNl1Th33XbugiHJzw",
    tier: 2,
  },
  {
    handle: "@stanfordhai",
    name: "youtube-stanford-hai",
    channelId: "UChugFTK0KyrES9terTid8vA",
    tier: 2,
  },
  {
    handle: "@broadinstitute",
    name: "youtube-broad-institute",
    channelId: "UCv4IbnP9j9RC_aZAs8wqdeQ",
    tier: 2,
  },
  {
    handle: "@ScienceMagazine",
    name: "youtube-science-magazine",
    channelId: "UCv0aU2eKry3kdSTnFa8QAWA",
    tier: 1,
  },
  {
    handle: "@QuantaScienceChannel",
    name: "youtube-quanta-science-channel",
    channelId: "UCTpmmkp1E4nmZqWPS-dl5bg",
    tier: 1,
  },
  {
    handle: "@chemistryworld",
    name: "youtube-chemistry-world",
    channelId: "UCJKnK9XCx8Q2x5sDqV1S0Yw",
    tier: 2,
  },
  {
    handle: "@MachineLearningStreetTalk",
    name: "youtube-machine-learning-street-talk",
    channelId: "UCMLtBahI5DMrt0NPvDSoIRQ",
    tier: 2,
  },
  {
    handle: "@aiDotEngineer",
    name: "youtube-ai-dot-engineer",
    channelId: "UCLKPca3kwwd-B59HNr-_lvA",
    tier: 3,
  },
] as const;

describe("owner-verified YouTube channels (2026-11-15)", () => {
  it("configures all 12 curated English channels as dedicated AI sources", () => {
    for (const expected of VERIFIED_CHANNELS) {
      const source = YOUTUBE_SOURCES.find((candidate) => candidate.handle === expected.handle);
      expect(source).toMatchObject({
        handle: expected.handle,
        name: expected.name,
        channelId: expected.channelId,
        language: "en",
        dedicatedAi: true,
      });
      expect(source?.tabs).toContain("videos");
    }
    expect(VERIFIED_CHANNELS).toHaveLength(12);
  });

  it("keeps every verified handle, name and channel ID unique", () => {
    for (const expected of VERIFIED_CHANNELS) {
      expect(
        YOUTUBE_SOURCES.filter((source) => source.handle === expected.handle),
      ).toHaveLength(1);
      expect(YOUTUBE_SOURCES.filter((source) => source.name === expected.name)).toHaveLength(1);
      expect(
        YOUTUBE_SOURCES.filter((source) => source.channelId === expected.channelId),
      ).toHaveLength(1);
    }
  });

  it("assigns the requested authority tier to every verified channel", () => {
    for (const expected of VERIFIED_CHANNELS) {
      expect(youtubeSourceTier(expected.name)).toBe(expected.tier);
    }
    // Legacy channels keep the pre-existing curated-channel default (+45).
    expect(youtubeSourceTier("youtube-two-minute-papers")).toBeNull();
  });
});

describe("curated YouTube sources", () => {
  it("includes the approved @Xenon_Lab channel", () => {
    expect(YOUTUBE_SOURCES).toContainEqual({
      channelId: "UCoIE_EIoxTypMAILucbUIvw",
      handle: "@Xenon_Lab",
      name: "youtube-xenon-lab",
      language: "ru",
      tabs: ["videos"],
      dedicatedAi: false,
    });
  });

  it("keeps channel names and IDs unique", () => {
    const names = YOUTUBE_SOURCES.map((source) => source.name);
    const channelIds = YOUTUBE_SOURCES.map((source) => source.channelId);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(channelIds).size).toBe(channelIds.length);
  });

  it("declares a handle, a language and at least one tab for every channel", () => {
    for (const source of YOUTUBE_SOURCES) {
      expect(source.handle.startsWith("@")).toBe(true);
      expect(["en", "ru"]).toContain(source.language);
      expect(source.tabs.length).toBeGreaterThan(0);
    }
  });
});

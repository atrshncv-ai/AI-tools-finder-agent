export type YoutubeTab = "videos" | "shorts";

export interface YoutubeSource {
  channelId: string;
  handle: string;
  name: string;
  language: "en" | "ru";
  tabs: YoutubeTab[];
  dedicatedAi: boolean;
}

export const YOUTUBE_SOURCES: YoutubeSource[] = [
  {
    channelId: "UCbfYPyITQ-7l4upoX8nvctg",
    handle: "@TwoMinutePapers",
    name: "youtube-two-minute-papers",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCZHmQk67mSJgfCCTn7xBfew",
    handle: "@YannicKilcher",
    name: "youtube-yannic-kilcher",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCawZsQWqfGSbCI5yjkdVkTA",
    handle: "@matthew_berman",
    name: "youtube-matthew-berman",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCkaXqLNhfpgzqGh8cu6E_3w",
    handle: "@vladimiraidev",
    name: "youtube-vladimir-ai-dev",
    language: "ru",
    tabs: ["shorts"],
    dedicatedAi: true,
  },
  {
    channelId: "UCXyfe8u58vBf2aSWLQjJtVA",
    handle: "@rinatsuleyman",
    name: "youtube-rinat-suleymanov",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UC37JpWP5PxLSma2lh79HU9A",
    handle: "@duncanrogoff",
    name: "youtube-duncan-rogoff",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCRwL-Z46UPuwmpFX_vM7d_w",
    handle: "@mcdenil_",
    name: "youtube-mcdenil",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCbebZGDxm5IYqNTlqHF1ODQ",
    handle: "@artemii-miller-ai",
    name: "youtube-artemii-miller",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UC_a85mUHqsy5j0CYCgLnkEQ",
    handle: "@DIYSmartCode",
    name: "youtube-diy-smart-code",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCHANXYGGO-weVbvoW5UBm9Q",
    handle: "@svyat404",
    name: "youtube-svyat404",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCKWaEZ-_VweaEx1j62do_vQ",
    handle: "@IBMTechnology",
    name: "youtube-ibm-technology",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: false,
  },
  {
    channelId: "UCgFaudM5mLnF4ixj6qeRhPQ",
    handle: "@NickVels_AI",
    name: "youtube-nickvels-ai",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCbbQ7fuPu7VgWXS_BvmEaIg",
    handle: "@Ai.easylife",
    name: "youtube-ai-easylife",
    language: "ru",
    tabs: ["videos", "shorts"],
    dedicatedAi: true,
  },
  {
    channelId: "UCoIE_EIoxTypMAILucbUIvw",
    handle: "@Xenon_Lab",
    name: "youtube-xenon-lab",
    language: "ru",
    tabs: ["videos"],
    dedicatedAi: false,
  },
  // Owner-verified via the YouTube Data API on 2026-11-15. Channel IDs were
  // resolved from each public channel page and are required by BOTH collection
  // paths (Data API + Atom/yt-dlp fallback).
  {
    channelId: "UCP7jMXSY2xbc3KCAE0MHQ-A",
    handle: "@GoogleDeepMind",
    name: "youtube-google-deepmind",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCT-VzthVAM_4ohDdKa-BbXA",
    handle: "@GoogleResearch",
    name: "youtube-google-research",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCCb9_Kn8F_Opb3UCGm-lILQ",
    handle: "@MicrosoftResearch",
    name: "youtube-microsoft-research",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCwx7Y3W30N8aS_tiCy2x-2g",
    handle: "@IBMResearch",
    name: "youtube-ibm-research",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCBpxspUNl1Th33XbugiHJzw",
    handle: "@MITCSAIL",
    name: "youtube-mit-csail",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UChugFTK0KyrES9terTid8vA",
    handle: "@stanfordhai",
    name: "youtube-stanford-hai",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCv4IbnP9j9RC_aZAs8wqdeQ",
    handle: "@broadinstitute",
    name: "youtube-broad-institute",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCv0aU2eKry3kdSTnFa8QAWA",
    handle: "@ScienceMagazine",
    name: "youtube-science-magazine",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCTpmmkp1E4nmZqWPS-dl5bg",
    handle: "@QuantaScienceChannel",
    name: "youtube-quanta-science-channel",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCJKnK9XCx8Q2x5sDqV1S0Yw",
    handle: "@chemistryworld",
    name: "youtube-chemistry-world",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCMLtBahI5DMrt0NPvDSoIRQ",
    handle: "@MachineLearningStreetTalk",
    name: "youtube-machine-learning-street-talk",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
  {
    channelId: "UCLKPca3kwwd-B59HNr-_lvA",
    handle: "@aiDotEngineer",
    name: "youtube-ai-dot-engineer",
    language: "en",
    tabs: ["videos"],
    dedicatedAi: true,
  },
];

export type YoutubeSourceTier = 1 | 2 | 3;

/**
 * Authority tier of the owner-verified science/industry channels. Only these
 * carry an explicit tier; legacy channels keep the curated-channel default
 * (+45) in youtube-policy, so adding a tier here is the ONLY way a channel
 * changes its authority weight.
 */
export const YOUTUBE_SOURCE_TIERS: Record<string, YoutubeSourceTier> = {
  "youtube-google-deepmind": 1,
  "youtube-google-research": 1,
  "youtube-microsoft-research": 1,
  "youtube-ibm-research": 1,
  "youtube-science-magazine": 1,
  "youtube-quanta-science-channel": 1,
  "youtube-mit-csail": 2,
  "youtube-stanford-hai": 2,
  "youtube-broad-institute": 2,
  "youtube-chemistry-world": 2,
  "youtube-machine-learning-street-talk": 2,
  "youtube-ai-dot-engineer": 3,
};

/** Tier of a configured channel, or null for a legacy/untiered channel. */
export function youtubeSourceTier(name: string): YoutubeSourceTier | null {
  return YOUTUBE_SOURCE_TIERS[(name ?? "").trim()] ?? null;
}

export const DEDICATED_AI_YOUTUBE_SOURCES = new Set(
  YOUTUBE_SOURCES.filter((source) => source.dedicatedAi).map((source) => source.name),
);

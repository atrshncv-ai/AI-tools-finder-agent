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
];

export const DEDICATED_AI_YOUTUBE_SOURCES = new Set(
  YOUTUBE_SOURCES.filter((source) => source.dedicatedAi).map((source) => source.name),
);

import { describe, expect, it } from "vitest";
import { YOUTUBE_SOURCES } from "../../scripts/hermes/youtube-sources";

describe("curated YouTube sources", () => {
  it("contains the four newly approved channels with verified channel IDs", () => {
    expect(
      YOUTUBE_SOURCES.map(({ name, channelId }) => ({ name, channelId })),
    ).toEqual(
      expect.arrayContaining([
        { name: "youtube-svyat404", channelId: "UCHANXYGGO-weVbvoW5UBm9Q" },
        { name: "youtube-ibm-technology", channelId: "UCKWaEZ-_VweaEx1j62do_vQ" },
        { name: "youtube-nickvels-ai", channelId: "UCgFaudM5mLnF4ixj6qeRhPQ" },
        { name: "youtube-ai-easylife", channelId: "UCbbQ7fuPu7VgWXS_BvmEaIg" },
      ]),
    );
  });

  it("collects ordinary videos for every channel and Shorts where configured", () => {
    const newSources = YOUTUBE_SOURCES.filter((source) =>
      [
        "youtube-svyat404",
        "youtube-ibm-technology",
        "youtube-nickvels-ai",
        "youtube-ai-easylife",
      ].includes(source.name),
    );

    expect(newSources.every((source) => source.tabs.includes("videos"))).toBe(true);
    expect(
      newSources.find((source) => source.name === "youtube-ai-easylife")?.tabs,
    ).toContain("shorts");
  });
});

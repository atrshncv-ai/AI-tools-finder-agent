import { describe, expect, it } from "vitest";
import { YOUTUBE_SOURCES } from "./youtube-sources";

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

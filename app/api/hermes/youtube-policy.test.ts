import { describe, expect, it } from "vitest";
import { scoreYoutubeCandidate } from "../../scripts/hermes/youtube-policy";

describe("YouTube publication policy", () => {
  it("rejects a video before approval when no transcript is available", () => {
    expect(
      scoreYoutubeCandidate({
        hasTranscript: false,
        durationSeconds: 600,
        dedicatedChannel: true,
        aiRelevant: true,
      }),
    ).toEqual({ eligible: false, score: 0, reason: "transcript-unavailable" });
  });

  it("prioritizes a transcribed 4–45 minute video over a transcribed Short", () => {
    const longVideo = scoreYoutubeCandidate({
      hasTranscript: true,
      durationSeconds: 12 * 60,
      dedicatedChannel: true,
      aiRelevant: true,
    });
    const short = scoreYoutubeCandidate({
      hasTranscript: true,
      durationSeconds: 55,
      dedicatedChannel: true,
      aiRelevant: true,
    });

    expect(longVideo.eligible).toBe(true);
    expect(short.eligible).toBe(true);
    expect(longVideo.score).toBeGreaterThan(short.score);
  });

  it("does not impose a daily cap on useful transcribed Shorts", () => {
    const shorts = Array.from({ length: 10 }, () =>
      scoreYoutubeCandidate({
        hasTranscript: true,
        durationSeconds: 50,
        dedicatedChannel: true,
        aiRelevant: true,
      }),
    );

    expect(shorts).toHaveLength(10);
    expect(shorts.every((candidate) => candidate.eligible && candidate.score > 65)).toBe(true);
  });
});

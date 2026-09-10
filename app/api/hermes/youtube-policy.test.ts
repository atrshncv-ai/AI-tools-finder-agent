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

  it("requires a REAL AI signal even on a dedicated channel (no auto-pass)", () => {
    const dedicatedWithoutSignal = scoreYoutubeCandidate({
      hasTranscript: true,
      durationSeconds: 12 * 60,
      dedicatedChannel: true,
      aiRelevant: false,
    });

    // 45 (curated authority) + 10 (transcript) + 10 (long-form) = 65 → not > 65.
    expect(dedicatedWithoutSignal.score).toBe(65);
    expect(dedicatedWithoutSignal.eligible).toBe(false);
  });

  it("grants the topic bonus on a real AI signal, even off a dedicated channel", () => {
    const plainChannelWithSignal = scoreYoutubeCandidate({
      hasTranscript: true,
      durationSeconds: 55,
      dedicatedChannel: false,
      aiRelevant: true,
    });

    // 45 + 15 (real AI topic) + 10 = 70 → eligible.
    expect(plainChannelWithSignal.score).toBe(70);
    expect(plainChannelWithSignal.eligible).toBe(true);
  });
});

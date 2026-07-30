import { describe, expect, it } from "vitest";
import { nextFailureState } from "../../scripts/hermes/failure-policy";

describe("Hermes failure policy", () => {
  it("rejects YouTube immediately when no transcript is available", () => {
    expect(nextFailureState({}, "fetch", "youtube-transcript-unavailable", true)).toEqual({
      attempts: 1,
      reject: true,
    });
  });

  it("rejects ordinary extraction failures on the third attempt", () => {
    const first = nextFailureState({}, "fetch", "content-unavailable", false);
    const second = nextFailureState(
      { fetch: { attempts: first.attempts, reason: "content-unavailable" } },
      "fetch",
      "content-unavailable",
      false,
    );
    const third = nextFailureState(
      { fetch: { attempts: second.attempts, reason: "content-unavailable" } },
      "fetch",
      "content-unavailable",
      false,
    );

    expect([first, second, third]).toEqual([
      { attempts: 1, reject: false },
      { attempts: 2, reject: false },
      { attempts: 3, reject: true },
    ]);
  });

  it("does not reject transient Zen failures", () => {
    expect(nextFailureState({}, "zen", "unavailable", false)).toEqual({
      attempts: 1,
      reject: false,
    });
  });
});

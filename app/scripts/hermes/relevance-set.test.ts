import { describe, expect, it } from "vitest";
import { hasExplicitAiSignal } from "../../api/lib/classify";
import type { CompleteJson } from "../../api/ai/providers/types";
import { DIRECTIONS, SECTIONS, directionById, sectionById } from "./topics";
import { judgeRelevance, type Judgement } from "./judge";
import { prefilterCandidate } from "./prefilter";
import {
  RELEASE_26_08_CASES,
  RELEVANCE_ACCURACY_FLOOR,
  RELEVANCE_FIXTURE_COUNT,
  RELEVANCE_FIXTURES,
  RELEVANCE_SOURCING_NOTE,
  USER_MISS_CASES,
  type RelevanceFixture,
} from "./relevance-fixtures";

interface FixtureRun {
  judgement: Judgement;
  /** 1 = verdict only, 2 = verdict + independent review. */
  calls: number;
}

/**
 * Replays the declared model answers. The set declares a review reply only for
 * cases where the judge must ask for one, so the number of calls is itself an
 * assertion: an extra review call hits an empty slot and becomes a rejection,
 * a missing one shows up in the accuracy count.
 */
async function judgeFixture(fixture: RelevanceFixture): Promise<FixtureRun> {
  const replies =
    fixture.reviewReply === null ? [fixture.modelReply] : [fixture.modelReply, fixture.reviewReply];
  let calls = 0;
  const completeJson: CompleteJson = async () => {
    const reply = replies[calls];
    if (reply === undefined) throw new Error(`${fixture.id}: unexpected extra judge call`);
    calls += 1;
    return { text: reply, provider: "gigachat", model: "GigaChat-2", usage: null };
  };
  const judgement = await judgeRelevance({ title: fixture.title, lead: fixture.lead }, { completeJson });
  return { judgement, calls };
}

function matchesExpected(judgement: Judgement, fixture: RelevanceFixture): boolean {
  return (
    judgement.onTopic === fixture.expected.onTopic &&
    judgement.section === fixture.expected.section &&
    judgement.direction === fixture.expected.direction
  );
}

/** True only if the judge attributed the material to that science direction. */
function onTopicFor(judgement: Judgement, direction: string): boolean {
  return judgement.onTopic && judgement.section === "science" && judgement.direction === direction;
}

const electricityCases = RELEVANCE_FIXTURES.filter((f) =>
  /энергосет|электрич|электросет|ЛЭП/i.test(`${f.title} ${f.lead}`),
);

/** Cases where a wrong-but-valid verdict exists in the data, or that R20 names. */
function isCritical(fixture: RelevanceFixture): boolean {
  return (
    fixture.origin !== "synthetic" ||
    fixture.id.startsWith("policy-") ||
    (fixture.expected.onTopic === false && fixture.reviewReply !== null)
  );
}

describe("relevance set — corpus integrity and declared numbers", () => {
  it("holds exactly the declared number of uniquely identified, fully labelled cases", () => {
    expect(RELEVANCE_FIXTURES.length).toBe(RELEVANCE_FIXTURE_COUNT);

    const ids = new Set<string>();
    for (const fixture of RELEVANCE_FIXTURES) {
      expect(fixture.id, "every case needs a stable id").toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(fixture.id), `duplicate fixture id ${fixture.id}`).toBe(false);
      ids.add(fixture.id);

      expect(fixture.title.trim().length).toBeGreaterThan(10);
      expect(fixture.note.trim().length).toBeGreaterThan(10);
      expect(sectionById(fixture.expected.section), `${fixture.id}: unknown section`).toBeDefined();
      if (fixture.expected.direction !== null) {
        expect(directionById(fixture.expected.direction), `${fixture.id}: unknown direction`).toBeDefined();
      }
      expect(["release-26.08", "user-miss", "synthetic"]).toContain(fixture.origin);
    }
  });

  it("checks the declared sourcing numbers and the recorded deviation, not a loose floor", () => {
    const release = RELEVANCE_FIXTURES.filter((f) => f.origin === "release-26.08");
    const userMiss = RELEVANCE_FIXTURES.filter((f) => f.origin === "user-miss");
    const sourced = release.length + userMiss.length;

    expect(release.length).toBe(RELEASE_26_08_CASES);
    expect(userMiss.length).toBe(USER_MISS_CASES);
    // R20 wants >=40 sourced cases; only 11 classes are named in reference.md
    // and the release was lost, so the set records a deviation instead.
    expect(sourced).toBe(12);
    expect(RELEVANCE_SOURCING_NOTE).toContain("reference.md");
    expect(RELEVANCE_SOURCING_NOTE).toContain(">=40");
    expect(RELEVANCE_SOURCING_NOTE).toContain("12");

    for (const fixture of RELEVANCE_FIXTURES) {
      expect(fixture.sourceRef.trim().length, `${fixture.id}: no provenance`).toBeGreaterThan(15);
      if (fixture.origin === "release-26.08") {
        expect(fixture.sourceRef).toMatch(/^reference\.md/);
      } else if (fixture.origin === "user-miss") {
        expect(fixture.sourceRef).toMatch(/^2026-11-10-brief\.md/);
      } else {
        expect(fixture.sourceRef).toMatch(/^synthetic:/);
      }
    }
  });

  it("covers the 26.08 misses and all three sections / six directions", () => {
    for (const section of SECTIONS) {
      expect(
        RELEVANCE_FIXTURES.some((f) => f.expected.onTopic && f.expected.section === section.id),
        `no accepted case for section ${section.id}`,
      ).toBe(true);
    }
    for (const direction of DIRECTIONS) {
      expect(
        RELEVANCE_FIXTURES.some((f) => f.expected.onTopic && f.expected.direction === direction.id),
        `no accepted case for direction ${direction.id}`,
      ).toBe(true);
    }
    expect(RELEVANCE_FIXTURES.some((f) => f.id === "release-starharness")).toBe(true);
    expect(RELEVANCE_FIXTURES.some((f) => f.id === "release-composites-perm")).toBe(true);
  });

  it("contains the canonical brief miss plus the synthetic electricity variants", () => {
    expect(RELEVANCE_FIXTURES.some((f) => f.id === "user-miss-energy-grid-dispatch")).toBe(true);
    expect(electricityCases).toHaveLength(4);
  });

  it("stage A agrees with the labels: no on-topic case is invisible to the AI gate", () => {
    const withoutSignal = RELEVANCE_FIXTURES.filter(
      (fixture) => !hasExplicitAiSignal(`${fixture.title} ${fixture.lead}`),
    );

    // The 26.08 release shipped several cards with no AI term at all; stage A
    // (not the judge) is what must stop them (R18.1).
    expect(withoutSignal.filter((f) => f.origin === "release-26.08").length).toBeGreaterThanOrEqual(3);

    for (const fixture of withoutSignal) {
      expect(fixture.expected.onTopic, `${fixture.id}: on-topic case without an explicit AI signal`).toBe(false);
      const result = prefilterCandidate({
        title: fixture.title,
        lead: fixture.lead,
        source: fixture.source,
        publishedAt: new Date(),
      });
      expect(result.keep, `${fixture.id}: stage A must drop it`).toBe(false);
    }
  });
});

describe("relevance set — accuracy (R20i)", () => {
  it(`judges at least ${RELEVANCE_ACCURACY_FLOOR * 100}% of the frozen set exactly as labelled`, async () => {
    const misses: Array<{ fixture: RelevanceFixture; message: string }> = [];
    let correct = 0;

    for (const fixture of RELEVANCE_FIXTURES) {
      const { judgement } = await judgeFixture(fixture);
      if (matchesExpected(judgement, fixture)) {
        correct += 1;
      } else {
        misses.push({
          fixture,
          message:
            `${fixture.id}: expected ${JSON.stringify(fixture.expected)}, got ` +
            `${JSON.stringify({ onTopic: judgement.onTopic, section: judgement.section, direction: judgement.direction })}`,
        });
      }
    }

    const accuracy = correct / RELEVANCE_FIXTURES.length;
    expect(accuracy, misses.map((m) => m.message).join("\n")).toBeGreaterThanOrEqual(
      RELEVANCE_ACCURACY_FLOOR,
    );

    // The 95% floor must never absorb a miss in the sourced classes, the
    // fail-closed policy cases, or the cases that only the independent review
    // can decide — those are exactly R20/R20e/R20i.
    const criticalMisses = misses.filter((miss) => isCritical(miss.fixture)).map((miss) => miss.message);
    expect(criticalMisses, criticalMisses.join("\n")).toEqual([]);
  });

  it("asks for a review exactly when the fixture declares one", async () => {
    for (const fixture of RELEVANCE_FIXTURES) {
      const { calls } = await judgeFixture(fixture);
      expect(calls, `${fixture.id}: wrong number of judge calls`).toBe(fixture.reviewReply === null ? 1 : 2);
    }
  });
});

describe("relevance set — the miss the owner named (R20e)", () => {
  it("catches a plausible wrong biology verdict for energy grids on the independent call", async () => {
    const grids = RELEVANCE_FIXTURES.find((f) => f.id === "user-miss-energy-grid-dispatch");
    expect(grids).toBeDefined();

    // The primary answer is exactly the mistake the owner reported: a valid
    // JSON verdict that puts energy grids into "Biology" with high confidence.
    const primary = JSON.parse((grids as RelevanceFixture).modelReply) as {
      onTopic: boolean;
      section: string;
      direction: string | null;
    };
    expect(primary.onTopic).toBe(true);
    expect(primary.section).toBe("science");
    expect(primary.direction).toBe("biology");

    const { judgement, calls } = await judgeFixture(grids as RelevanceFixture);

    // "ИИ в биологии" содержит новость про электрику — так больше нельзя.
    expect(calls).toBe(2);
    expect(judgement.onTopic).toBe(false);
    expect(judgement.section).toBe("ai-news");
    expect(judgement.direction).toBeNull();
    expect(onTopicFor(judgement, "biology")).toBe(false);
    expect(onTopicFor(judgement, "physics")).toBe(false);
  });

  it("keeps every electricity-class case out of all science directions", async () => {
    for (const fixture of electricityCases) {
      const { judgement } = await judgeFixture(fixture);
      expect(judgement.onTopic, fixture.id).toBe(false);
      for (const direction of DIRECTIONS) {
        expect(onTopicFor(judgement, direction.id), `${fixture.id} attributed to ${direction.id}`).toBe(false);
      }
    }
  });

  it("rejects broken model or review answers instead of throwing (fail-closed)", async () => {
    const failClosed = RELEVANCE_FIXTURES.filter(
      (f) => f.id.startsWith("policy-") || (f.expected.onTopic === false && f.reviewReply !== null),
    );
    for (const fixture of failClosed) {
      const { judgement } = await judgeFixture(fixture);
      expect(judgement.onTopic, fixture.id).toBe(false);
      expect(["invalid-judgement", "low-confidence", "rejected-by-review", "invalid-review"]).toContain(
        judgement.reason,
      );
    }
  });
});

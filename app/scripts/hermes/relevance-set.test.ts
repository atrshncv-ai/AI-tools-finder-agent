import { describe, expect, it } from "vitest";
import { hasExplicitAiSignal } from "../../api/lib/classify";
import { DIRECTIONS, SECTIONS, directionById, sectionById } from "./topics";
import { judgeRelevance, type CompleteJson, type Judgement } from "./judge";
import { prefilterCandidate } from "./prefilter";
import {
  RELEVANCE_ACCURACY_FLOOR,
  RELEVANCE_FIXTURES,
  type RelevanceFixture,
} from "./relevance-fixtures";

function judgeFixture(fixture: RelevanceFixture): Promise<Judgement> {
  const completeJson: CompleteJson = async () => ({ text: fixture.modelReply });
  return judgeRelevance({ title: fixture.title, lead: fixture.lead }, { completeJson });
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

describe("relevance set — corpus integrity (R20)", () => {
  it("holds at least 60 uniquely identified, fully labelled cases", () => {
    expect(RELEVANCE_FIXTURES.length).toBeGreaterThanOrEqual(60);

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

  it("covers the 26.08 misses and all three sections / six directions", () => {
    const releaseCases = RELEVANCE_FIXTURES.filter((f) => f.origin === "release-26.08");
    expect(releaseCases.length).toBeGreaterThanOrEqual(10);

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
  });

  it("contains the synthetic energoset/electrics-with-AI case", () => {
    const electrics = RELEVANCE_FIXTURES.filter(
      (f) => f.origin === "user-miss" && /энергосет|электрик|электр|ЛЭП/i.test(`${f.title} ${f.lead}`),
    );
    expect(electrics.length).toBeGreaterThanOrEqual(1);
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
    const misses: string[] = [];
    let correct = 0;

    for (const fixture of RELEVANCE_FIXTURES) {
      const judgement = await judgeFixture(fixture);
      if (matchesExpected(judgement, fixture)) {
        correct += 1;
      } else {
        misses.push(
          `${fixture.id}: expected ${JSON.stringify(fixture.expected)}, got ` +
            `${JSON.stringify({ onTopic: judgement.onTopic, section: judgement.section, direction: judgement.direction })}`,
        );
      }
    }

    const accuracy = correct / RELEVANCE_FIXTURES.length;
    // The floor is the acceptance bar; the message lists the misses so a drop
    // is diagnosable from CI output.
    expect(accuracy, misses.join("\n")).toBeGreaterThanOrEqual(RELEVANCE_ACCURACY_FLOOR);

    // The 95% floor allows three misses in the synthetic tail; it must never
    // absorb a miss in the classes the owner actually named or in the
    // fail-closed policy cases.
    const criticalMisses = misses.filter((miss) => /^(release-|user-miss-|policy-)/.test(miss));
    expect(criticalMisses, criticalMisses.join("\n")).toEqual([]);
  });
});

describe("relevance set — the miss the owner named (R20e)", () => {
  it("never puts an energy-grid/electrics card into biology or physics", async () => {
    const grids = RELEVANCE_FIXTURES.find((f) => f.id === "user-miss-energy-grid-dispatch");
    expect(grids).toBeDefined();

    const judgement = await judgeFixture(grids as RelevanceFixture);

    // "ИИ в биологии" содержит новость про электрику — так больше нельзя.
    expect(judgement.onTopic).toBe(false);
    expect(onTopicFor(judgement, "biology")).toBe(false);
    expect(onTopicFor(judgement, "physics")).toBe(false);
  });

  it("keeps every user-reported miss out of the labelled science directions", async () => {
    for (const fixture of RELEVANCE_FIXTURES.filter((f) => f.origin === "user-miss")) {
      const judgement = await judgeFixture(fixture);
      for (const direction of DIRECTIONS) {
        expect(onTopicFor(judgement, direction.id), `${fixture.id} attributed to ${direction.id}`).toBe(false);
      }
    }
  });

  it("rejects broken model answers instead of throwing (fail-closed)", async () => {
    for (const fixture of RELEVANCE_FIXTURES.filter((f) => f.id.startsWith("policy-"))) {
      const judgement = await judgeFixture(fixture);
      expect(judgement.onTopic, fixture.id).toBe(false);
      expect(["invalid-judgement", "low-confidence"]).toContain(judgement.reason);
    }
  });
});

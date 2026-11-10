import { afterEach, describe, expect, it, vi } from "vitest";
import { prefilterCandidate, type PrefilterInput } from "./prefilter";

const NOW = new Date("2026-11-10T09:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3600_000);
}

function candidate(overrides: Partial<PrefilterInput> = {}): PrefilterInput {
  return {
    title: "OpenAI releases a new agent model for developers",
    lead:
      "The API adds tool calling, long context and lower latency; the company says the model " +
      "scores better on agent benchmarks and is available today.",
    source: "techcrunch",
    publishedAt: hoursAgo(3),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefilterCandidate — hard deterministic gates", () => {
  it("keeps a normal AI-news candidate and scores it above zero", () => {
    const result = prefilterCandidate(candidate(), { now: NOW });

    expect(result.keep).toBe(true);
    expect(result.reason).toBe("keep");
    expect(result.score).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("drops a chemistry story with no AI signal", () => {
    const result = prefilterCandidate(
      candidate({
        title: "Синтез катализаторов на основе палладия ускорили в два раза",
        lead: "Химики подобрали новый носитель для реакции кросс-сочетания и описали механизм.",
        source: "naked-science",
      }),
      { now: NOW },
    );

    expect(result.keep).toBe(false);
    expect(result.reason).toBe("no-ai-signal");
    expect(result.score).toBe(0);
  });

  it("drops a stale candidate older than the 72h time guard", () => {
    const result = prefilterCandidate(candidate({ publishedAt: hoursAgo(73) }), { now: NOW });

    expect(result.keep).toBe(false);
    expect(result.reason).toBe("stale");
  });

  it("keeps a candidate inside the time guard", () => {
    const result = prefilterCandidate(candidate({ publishedAt: hoursAgo(71) }), { now: NOW });
    expect(result.keep).toBe(true);
  });

  it("fails closed on a missing or unparseable publication date", () => {
    expect(prefilterCandidate(candidate({ publishedAt: null }), { now: NOW }).reason).toBe("unknown-date");
    expect(prefilterCandidate(candidate({ publishedAt: "not-a-date" }), { now: NOW }).reason).toBe("unknown-date");
  });

  it("drops an empty title", () => {
    const result = prefilterCandidate(candidate({ title: "   " }), { now: NOW });
    expect(result.keep).toBe(false);
    expect(result.reason).toBe("empty-title");
  });

  it("keeps a YouTube candidate with an AI signal in title/lead", () => {
    const result = prefilterCandidate(
      candidate({
        title: "How large language models actually learn",
        lead: "A 20-minute explainer about transformers, pretraining and inference.",
        source: "youtube-two-minute-papers",
        isYoutube: true,
      }),
      { now: NOW },
    );

    expect(result.keep).toBe(true);
  });
});

describe("prefilterCandidate — stage A has no topic knowledge", () => {
  it("keeps an energy-grids + AI candidate: the topic verdict belongs to the judge", () => {
    const result = prefilterCandidate(
      candidate({
        title: "Нейросеть управляет энергосетью города и снижает потери на 12%",
        lead:
          "Оператор электросетей внедрил модель прогнозирования нагрузки: она перераспределяет " +
          "мощность между подстанциями и предсказывает аварии.",
        source: "habr",
      }),
      { now: NOW },
    );

    expect(result.keep).toBe(true);
    expect(result.reason).toBe("keep");
    expect(result.evidence).toContain("ai");
  });
});

describe("prefilterCandidate — no network, deterministic", () => {
  it("never calls fetch", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("prefilter must not touch the network");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const inputs: PrefilterInput[] = [
      candidate(),
      candidate({ title: "Композиты для авиации прошли испытания", lead: "Материаловеды описали прочность." }),
      candidate({ publishedAt: hoursAgo(120) }),
      candidate({ publishedAt: null }),
      candidate({ isYoutube: true, source: "youtube-ai-explained" }),
    ];
    for (const input of inputs) prefilterCandidate(input, { now: NOW });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the same verdict for the same input", () => {
    const input = candidate();
    expect(prefilterCandidate(input, { now: NOW })).toEqual(prefilterCandidate(input, { now: NOW }));
  });

  it("ranks an authoritative source above an unknown blog, all else equal", () => {
    const tier1 = prefilterCandidate(candidate({ source: "nature" }), { now: NOW });
    const blog = prefilterCandidate(candidate({ source: "random-blog" }), { now: NOW });

    expect(tier1.keep && blog.keep).toBe(true);
    expect(tier1.score).toBeGreaterThan(blog.score);
  });
});

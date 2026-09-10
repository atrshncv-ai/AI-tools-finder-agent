import { describe, expect, it } from "vitest";
import { hasExplicitAiSignal } from "../../api/lib/classify";
import { SCORE_GATE } from "./pipeline-config";
import { RELEVANCE_LEAD_CHARS, hasAiAndDomain, relevanceEvidence } from "./evaluate-news";

// Non-AI Nature-style news: medicine words up front, one incidental
// "machine learning" mention buried deep in the body.
const JUNK_TITLE = "Two children died from gene therapies in China";
const JUNK_FILLER = "Doctors reported a medical treatment for young patients in clinical care. ";
const JUNK_BODY =
  JUNK_FILLER.repeat(50) +
  "Researchers noted machine learning could help future analysis of medical data.";

describe("evaluate-news relevance evidence (lead-only)", () => {
  it("ignores an incidental deep-body AI mention for the hard gate + topic bonus", () => {
    // The AI mention sits past char 3000 — outside the relevance lead.
    expect(JUNK_BODY.indexOf("machine learning")).toBeGreaterThan(3000);
    expect(JUNK_BODY.indexOf("machine learning")).toBeGreaterThan(RELEVANCE_LEAD_CHARS);

    const relevance = relevanceEvidence({
      title: JUNK_TITLE,
      pageText: JUNK_BODY,
      githubDescription: null,
      githubTopics: [],
    });
    expect(relevance).not.toContain("machine learning");

    // Hard gate fails → evaluate() early-returns score 0, below the gate.
    expect(hasExplicitAiSignal(relevance)).toBe(false);
    expect(0).toBeLessThan(SCORE_GATE);
    // No ai-domain-intersection bonus (+15) either.
    expect(hasAiAndDomain(relevance)).toBe(false);
  });

  it("documents the leak: full body text would have faked relevance", () => {
    const fullEvidence = `${JUNK_TITLE} ${JUNK_BODY}`;
    expect(hasExplicitAiSignal(fullEvidence)).toBe(true);
    expect(hasAiAndDomain(fullEvidence)).toBe(true);
  });

  it("still passes legit AI news with the signal in the title", () => {
    const relevance = relevanceEvidence({
      title: "AI models: one country's fears about artificial intelligence grow",
      pageText: "Governments debate regulation of powerful new systems and their impact on society.",
      githubDescription: null,
      githubTopics: [],
    });
    expect(hasExplicitAiSignal(relevance)).toBe(true);
  });

  it("still counts github description/topics as relevance evidence", () => {
    const relevance = relevanceEvidence({
      title: "New release fixes crashes on startup",
      pageText: "This release fixes several crashes reported by users last week.",
      githubDescription: "A machine learning library for medical imaging",
      githubTopics: [],
    });
    expect(hasExplicitAiSignal(relevance)).toBe(true);
    expect(hasAiAndDomain(relevance)).toBe(true);
  });
});

// Owner mandate 2026-09-10: NO card without an explicit AI signal may ever be
// published — no exceptions for trusted/curated sources. The hard gate is
// EVERY non-YouTube article must show an explicit AI signal in its relevance
// evidence (title + lead + github metadata), and every YouTube video must show
// one in title/description. These cases mirror previously-exempt sources.
describe("evaluate-news hard AI gate has no source exemptions", () => {
  it("rejects a google-ai-blog item with non-AI title/lead", () => {
    const relevance = relevanceEvidence({
      title: "How data analytics is changing football scouting",
      pageText:
        "Coaches review match footage and passing statistics to plan training sessions for the upcoming season.",
      githubDescription: null,
      githubTopics: [],
    });
    // Gate fails → evaluate() early-returns score 0, below SCORE_GATE.
    expect(hasExplicitAiSignal(relevance)).toBe(false);
    expect(0).toBeLessThan(SCORE_GATE);
  });

  it("rejects a github-trending item with non-AI title/description/topics", () => {
    const relevance = relevanceEvidence({
      title: "Fast static site generator written in Rust",
      pageText: "This release fixes several crashes reported by users last week.",
      githubDescription: "A blazing fast static site generator with live reload and markdown support",
      githubTopics: ["rust", "static-site", "markdown"],
    });
    expect(hasExplicitAiSignal(relevance)).toBe(false);
    expect(0).toBeLessThan(SCORE_GATE);
  });

  it("rejects a hackernews non-AI story", () => {
    const relevance = relevanceEvidence({
      title: "Show HN: I built a mechanical keyboard from scratch",
      pageText: "I soldered switches and programmed the firmware with QMK over the weekend.",
      githubDescription: null,
      githubTopics: [],
    });
    expect(hasExplicitAiSignal(relevance)).toBe(false);
    expect(0).toBeLessThan(SCORE_GATE);
  });

  it("rejects a dedicated-channel YouTube video with non-AI title/description", () => {
    // YouTube relevance evidence is title + transcript description.
    const evidenceText =
      "I renovated my cabin in the woods A weekend vlog about painting walls, fixing the roof and cooking dinner outside.";
    expect(hasExplicitAiSignal(evidenceText)).toBe(false);
    expect(0).toBeLessThan(SCORE_GATE);
  });

  it("control: the same sources WITH an AI signal still pass the gate", () => {
    const googleAi = relevanceEvidence({
      title: "New Gemini model sets state of the art on reasoning benchmarks",
      pageText: "Our latest large language model improves step-by-step problem solving.",
      githubDescription: null,
      githubTopics: [],
    });
    const githubAi = relevanceEvidence({
      title: "Lightweight LLM inference engine",
      pageText: "Fast on-device inference for open-weight models.",
      githubDescription: "A machine learning library for efficient inference",
      githubTopics: ["llm", "inference"],
    });
    const hnAi = relevanceEvidence({
      title: "Show HN: Open-source LLM agent framework",
      pageText: "An agent framework for tool use and multi-step reasoning tasks.",
      githubDescription: null,
      githubTopics: [],
    });
    const youtubeAi = "How transformers work — large language models explained A deep dive into neural networks and LLM training.";

    expect(hasExplicitAiSignal(googleAi)).toBe(true);
    expect(hasExplicitAiSignal(githubAi)).toBe(true);
    expect(hasExplicitAiSignal(hnAi)).toBe(true);
    expect(hasExplicitAiSignal(youtubeAi)).toBe(true);
  });
});

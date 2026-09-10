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

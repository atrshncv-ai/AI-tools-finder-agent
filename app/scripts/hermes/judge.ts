/**
 * judge.ts — the ONE place where "is this material about our topic?" is
 * decided by an LLM (R07.1, spec §3).
 *
 * Contract:
 *   - input is title + lead only (the expensive page is never fetched for the
 *     judge — R18.1);
 *   - the model answers strict JSON; invalid JSON, an unknown section/direction
 *     or a confidence below JUDGE_CONFIDENCE_THRESHOLD is a rejection, never an
 *     exception (fail-closed: "лучше пропустить, чем промахнуться");
 *   - the prompt comes from topics.ts, so a new direction needs no edit here.
 *
 * The module knows nothing about the DB, budgets or publication. The LLM is
 * injected through `completeJson`, so tests never touch the network.
 */

import {
  TOPIC_PROMPT_RU,
  directionById,
  sectionById,
  type DirectionId,
  type SectionId,
} from "./topics";

export const JUDGE_CONFIDENCE_THRESHOLD = 0.7;

export const INVALID_JUDGEMENT_REASON = "invalid-judgement";
export const LOW_CONFIDENCE_REASON = "low-confidence";

/** Judgement JSON is short; the cap keeps a chatty model from burning tokens. */
const JUDGE_MAX_TOKENS = 300;
/** Deterministic verdicts: the same material must not flip between runs. */
const JUDGE_TEMPERATURE = 0;
const MAX_REASON_CHARS = 240;

export type JudgeChatRole = "system" | "user" | "assistant";

export interface JudgeChatMessage {
  role: JudgeChatRole;
  content: string;
}

/**
 * Structural twin of `CompleteJson` from app/api/ai/providers/types.ts
 * (declared locally because that module did not exist yet — see CONCERNS).
 * Optional metadata keeps the two assignable in both directions.
 */
export interface JudgeChatResult {
  text: string;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number } | null;
}

export type CompleteJson = (args: {
  messages: JudgeChatMessage[];
  maxTokens?: number;
  temperature?: number;
}) => Promise<JudgeChatResult>;

export interface Judgement {
  onTopic: boolean;
  section: SectionId;
  direction: DirectionId | null;
  /** 0..1 */
  confidence: number;
  /** one line, Russian */
  reason: string;
}

export interface JudgeInput {
  title: string;
  lead: string;
  language?: string | null;
}

export interface JudgeDeps {
  completeJson?: CompleteJson;
}

interface ParsedVerdict {
  onTopic: boolean;
  section: SectionId;
  direction: DirectionId | null;
  confidence: number;
  reason: string;
}

function invalidJudgement(): Judgement {
  return {
    onTopic: false,
    section: "ai-news",
    direction: null,
    confidence: 0,
    reason: INVALID_JUDGEMENT_REASON,
  };
}

/**
 * Pull the JSON object out of a model answer. Accepts a bare object, a
 * markdown fence and an object surrounded by prose; anything else (array,
 * truncated text, plain words) is not a verdict.
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  if (!candidate) return null;

  // A JSON array is a wrong shape even if it contains an object: refuse it
  // before slicing object braces out of it — also when prose wraps the array.
  if (candidate.startsWith("[")) return null;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  if (candidate.slice(0, start).trimEnd().endsWith("[")) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeReason(reason: string): string {
  const oneLine = reason.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_REASON_CHARS ? oneLine.slice(0, MAX_REASON_CHARS) : oneLine;
}

/**
 * Shape check: every field is required, ids must exist in the topics registry,
 * and section/direction must be consistent — "science" without a direction or
 * a direction attached to "ai-news" is a routing contradiction, i.e. a broken
 * answer, not a verdict to repair.
 */
function parseVerdict(raw: unknown): ParsedVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const { onTopic, section, direction, confidence, reason } = record;

  if (typeof onTopic !== "boolean") return null;
  if (typeof section !== "string" || !sectionById(section)) return null;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return null;
  }
  if (typeof reason !== "string" || reason.trim().length === 0) return null;

  let parsedDirection: DirectionId | null = null;
  if (direction !== null && direction !== undefined) {
    if (typeof direction !== "string" || !directionById(direction)) return null;
    parsedDirection = direction as DirectionId;
  }

  const sectionId = section as SectionId;
  if (sectionId === "science" && parsedDirection === null) return null;
  if (sectionId === "ai-news" && parsedDirection !== null) return null;

  return {
    onTopic,
    section: sectionId,
    direction: parsedDirection,
    confidence,
    reason: normalizeReason(reason),
  };
}

function buildMessages(input: JudgeInput): JudgeChatMessage[] {
  const title = (input.title ?? "").trim();
  const lead = (input.lead ?? "").trim();
  const language = (input.language ?? "").trim();

  const lines = [
    language ? `Язык материала: ${language}` : null,
    "Оцени материал и верни только JSON по правилам рубрики.",
    "--- BEGIN ARTICLE (UNTRUSTED) ---",
    `Заголовок: ${title}`,
    `Лид: ${lead}`,
    "--- END ARTICLE ---",
  ].filter((line): line is string => line !== null);

  return [
    { role: "system", content: TOPIC_PROMPT_RU },
    { role: "user", content: lines.join("\n") },
  ];
}

export async function judgeRelevance(input: JudgeInput, deps: JudgeDeps = {}): Promise<Judgement> {
  const completeJson = deps.completeJson;
  if (!completeJson) return invalidJudgement();

  const title = (input.title ?? "").trim();
  const lead = (input.lead ?? "").trim();
  if (!title && !lead) return invalidJudgement();

  let replyText = "";
  try {
    const result = await completeJson({
      messages: buildMessages(input),
      maxTokens: JUDGE_MAX_TOKENS,
      temperature: JUDGE_TEMPERATURE,
    });
    replyText = typeof result?.text === "string" ? result.text : "";
  } catch {
    // Provider failures are the chain's business (retries, alerts); the judge
    // itself never propagates them: a missing verdict means "do not publish".
    return invalidJudgement();
  }

  const verdict = parseVerdict(extractJsonObject(replyText));
  if (!verdict) return invalidJudgement();

  if (verdict.onTopic && verdict.confidence < JUDGE_CONFIDENCE_THRESHOLD) {
    return { ...verdict, onTopic: false, reason: LOW_CONFIDENCE_REASON };
  }

  return verdict;
}

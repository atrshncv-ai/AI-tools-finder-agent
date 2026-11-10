/**
 * judge.ts — the ONE place where "is this material about our topic?" is
 * decided by an LLM (R07.1, spec §3).
 *
 * Two calls, both fail-closed:
 *   1. verdict — strict JSON {onTopic, section, direction, confidence, reason}
 *      over title + lead only (the expensive page is never fetched — R18.1);
 *   2. review — an independent question about the *claimed* section/direction
 *      over the same text. A confident-but-wrong verdict (energy grids filed
 *      as "biology", the miss the owner named) is not detectable by inspecting
 *      its own JSON, so a second, differently-framed answer decides. Only
 *      on-topic verdicts above the confidence threshold pay for this call.
 *
 * Any unparsable answer, unknown id, inconsistent section/direction, low
 * confidence or review disagreement is a rejection with a reason code, never
 * an exception ("лучше пропустить, чем промахнуться"). A rejected verdict is
 * normalised to the neutral shape (section "ai-news", no direction) so no
 * downstream stage ever sees a rejected card attributed to a science field.
 *
 * The prompt comes from topics.ts, so a new direction needs no edit here. The
 * module knows nothing about the DB, budgets or publication; the LLM is the
 * shared `CompleteJson` injected by the provider chain, so tests never touch
 * the network.
 */

import {
  TOPIC_PROMPT_RU,
  directionById,
  sectionById,
  type DirectionId,
  type SectionId,
} from "./topics";
import type { ChatMessage, CompleteJson } from "../../api/ai/providers/types";

export const JUDGE_CONFIDENCE_THRESHOLD = 0.7;

export const INVALID_JUDGEMENT_REASON = "invalid-judgement";
export const LOW_CONFIDENCE_REASON = "low-confidence";
export const REJECTED_BY_REVIEW_REASON = "rejected-by-review";
export const INVALID_REVIEW_REASON = "invalid-review";

/** Verdict/review JSON is short; the cap keeps a chatty model from burning tokens. */
const JUDGE_MAX_TOKENS = 300;
const REVIEW_MAX_TOKENS = 200;
/** Deterministic verdicts: the same material must not flip between runs. */
const JUDGE_TEMPERATURE = 0;
const MAX_REASON_CHARS = 240;

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

type ParsedVerdict = Judgement;

interface ParsedReview {
  agree: boolean;
  confidence: number;
  reason: string;
}

type ReviewDecision = { ok: true } | { ok: false; reason: string };

function rejected(confidence: number, reason: string): Judgement {
  return { onTopic: false, section: "ai-news", direction: null, confidence, reason };
}

function invalidJudgement(): Judgement {
  return rejected(0, INVALID_JUDGEMENT_REASON);
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

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Shape check: every field is required, ids must exist in the topics registry,
 * and section/direction must be consistent — "science" without a direction or
 * a direction attached to "ai-news" is a routing contradiction, i.e. a broken
 * answer, not a verdict to repair.
 */
function parseVerdict(raw: unknown): ParsedVerdict | null {
  if (!isPlainObject(raw)) return null;

  const { onTopic, section, direction, confidence, reason } = raw;

  if (typeof onTopic !== "boolean") return null;
  if (typeof section !== "string" || !sectionById(section)) return null;
  if (!isConfidence(confidence)) return null;
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

function parseReview(raw: unknown): ParsedReview | null {
  if (!isPlainObject(raw)) return null;

  const { agree, confidence, reason } = raw;
  if (typeof agree !== "boolean") return null;
  if (!isConfidence(confidence)) return null;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;

  return { agree, confidence, reason: normalizeReason(reason) };
}

function buildMessages(input: JudgeInput): ChatMessage[] {
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

/**
 * The review is a separate question, not a paraphrase of the verdict: it names
 * what is being checked (section definition, direction definition) and asks the
 * model to disagree when in doubt.
 */
function reviewMessages(input: JudgeInput, verdict: ParsedVerdict): ChatMessage[] {
  const section = sectionById(verdict.section);
  const direction = verdict.direction ? directionById(verdict.direction) : null;

  const system = [
    "Ты — независимый проверяющий научно-новостного дайджеста. Другой судья уже вынес вердикт; " +
      "проверь его заново по тексту материала, а не по формулировке вердикта.",
    "Подтверждай (agree=true) только если материал действительно про названный раздел и направление. " +
      "Энергосети, электрика, ЛЭП и энергетика сами по себе не относятся к направлениям науки. " +
      "При сомнении ставь agree=false. confidence — число от 0 до 1; ниже 0.7 вердикт будет отклонён.",
    "Ответ — строго один JSON-объект без markdown: " +
      '{"agree": true, "confidence": 0.9, "reason": "одна строка по-русски"}',
  ].join("\n");

  const title = (input.title ?? "").trim();
  const lead = (input.lead ?? "").trim();
  // The claimed verdict is our own model's data, not instructions: it goes into
  // the user turn, while the article stays inside the untrusted markers.
  const user = [
    "Первый судья вынес вердикт:",
    `Раздел: ${verdict.section} («${section?.label ?? verdict.section}»): ${section?.definition ?? ""}`,
    direction
      ? `Направление: ${direction.id} («${direction.label}»): ${direction.definition}`
      : "Направление: не указано.",
    `Обоснование первого судьи: ${verdict.reason}`,
    "",
    "Материал:",
    "--- BEGIN ARTICLE (UNTRUSTED) ---",
    `Заголовок: ${title}`,
    `Лид: ${lead}`,
    "--- END ARTICLE ---",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function reviewVerdict(
  input: JudgeInput,
  verdict: ParsedVerdict,
  completeJson: CompleteJson,
): Promise<ReviewDecision> {
  let replyText = "";
  try {
    const result = await completeJson({
      messages: reviewMessages(input, verdict),
      maxTokens: REVIEW_MAX_TOKENS,
      temperature: JUDGE_TEMPERATURE,
    });
    replyText = typeof result?.text === "string" ? result.text : "";
  } catch {
    return { ok: false, reason: INVALID_REVIEW_REASON };
  }

  const review = parseReview(extractJsonObject(replyText));
  if (!review) return { ok: false, reason: INVALID_REVIEW_REASON };
  if (!review.agree || review.confidence < JUDGE_CONFIDENCE_THRESHOLD) {
    return { ok: false, reason: REJECTED_BY_REVIEW_REASON };
  }
  return { ok: true };
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
  if (!verdict.onTopic) return rejected(verdict.confidence, verdict.reason);
  if (verdict.confidence < JUDGE_CONFIDENCE_THRESHOLD) {
    return rejected(verdict.confidence, LOW_CONFIDENCE_REASON);
  }

  const review = await reviewVerdict(input, verdict, completeJson);
  if (!review.ok) return rejected(verdict.confidence, review.reason);

  return verdict;
}

const LONG_VIDEO_MIN_SECONDS = 4 * 60;
const LONG_VIDEO_MAX_SECONDS = 45 * 60;

/**
 * `news.metrics.origin` of a video ingested by the official YouTube Data API
 * (app/scripts/hermes/youtube-api.ts). On the production host youtube.com is
 * blocked by hostname while youtube.googleapis.com answers, so yt-dlp cannot
 * reach the video and the API is the only collector: it delivers title,
 * description and date, never captions.
 */
export const YOUTUBE_API_ORIGIN = "youtube-api";

/**
 * `news.metrics.transcript` written for such a video: the transcript is missing
 * BY DESIGN, not because the material failed a check. Everything downstream
 * (evaluate-news, save-summary) keys the "description is enough" behaviour off
 * `origin`, never off this marker.
 */
export const DESCRIPTION_ONLY_TRANSCRIPT = "unavailable-description-only";

interface YoutubeCandidateSignals {
  hasTranscript: boolean;
  durationSeconds: number | null;
  dedicatedChannel: boolean;
  aiRelevant: boolean;
  /**
   * The Data API origin: title + description are the whole material and no
   * transcript will ever be fetched. `hasTranscript` stays false, so the
   * "missing transcript" refusal must not fire for this candidate.
   */
  descriptionOnly?: boolean;
}

export interface YoutubeCandidateDecision {
  eligible: boolean;
  score: number;
  reason: "transcript-unavailable" | "description-only" | "scored";
  longFormPriority?: boolean;
}

export function isPriorityLongVideo(durationSeconds: number | null): boolean {
  return (
    durationSeconds !== null &&
    durationSeconds >= LONG_VIDEO_MIN_SECONDS &&
    durationSeconds <= LONG_VIDEO_MAX_SECONDS
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether the stored collection marker says "this video was ingested by the
 * official Data API, so a transcript is unavailable by design". Only an exact
 * `origin: "youtube-api"` qualifies: every other row keeps the transcript path.
 */
export function isDescriptionOnlyVideo(metrics: unknown): boolean {
  return asRecord(metrics)?.origin === YOUTUBE_API_ORIGIN;
}

/**
 * There is intentionally no Shorts quota: every useful transcribed Short may
 * pass. Ordinary 4–45 minute videos receive a ranking bonus, not a reservation.
 *
 * Owner mandate 2026-09-10: topic relevance (+15) requires a REAL explicit AI
 * signal (aiRelevant). dedicatedChannel is kept in the signature for call-site
 * stability but grants only the +45 curation/authority bonus, never relevance.
 *
 * Description-only videos (Data API origin) are scored on the material that
 * exists: the +10 "verified transcript" bonus is NOT paid, because a
 * description is weaker evidence than a transcript. They still clear the 50
 * gate on curation + topic (60) and rank below an equivalent transcribed video.
 */
export function scoreYoutubeCandidate(
  signals: YoutubeCandidateSignals,
): YoutubeCandidateDecision {
  if (!signals.hasTranscript) {
    if (!signals.descriptionOnly) {
      return { eligible: false, score: 0, reason: "transcript-unavailable" };
    }
    const longFormPriority = isPriorityLongVideo(signals.durationSeconds);
    const score =
      45 + // curated source (authority, not relevance)
      (signals.aiRelevant ? 15 : 0) +
      (longFormPriority ? 10 : 0);

    return {
      // The transcript refusal is not this candidate's verdict: an on-topic
      // description-only video is eligible, the judge and the score decide.
      eligible: signals.aiRelevant,
      score,
      reason: "description-only",
      longFormPriority,
    };
  }

  const longFormPriority = isPriorityLongVideo(signals.durationSeconds);
  const score =
    45 + // curated source (authority, not relevance)
    (signals.aiRelevant ? 15 : 0) +
    10 + // verified transcript
    (longFormPriority ? 10 : 0);

  return {
    eligible: score > 65,
    score,
    reason: "scored",
    longFormPriority,
  };
}

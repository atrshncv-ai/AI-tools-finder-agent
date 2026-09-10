const LONG_VIDEO_MIN_SECONDS = 4 * 60;
const LONG_VIDEO_MAX_SECONDS = 45 * 60;

interface YoutubeCandidateSignals {
  hasTranscript: boolean;
  durationSeconds: number | null;
  dedicatedChannel: boolean;
  aiRelevant: boolean;
}

export interface YoutubeCandidateDecision {
  eligible: boolean;
  score: number;
  reason: "transcript-unavailable" | "scored";
  longFormPriority?: boolean;
}

export function isPriorityLongVideo(durationSeconds: number | null): boolean {
  return (
    durationSeconds !== null &&
    durationSeconds >= LONG_VIDEO_MIN_SECONDS &&
    durationSeconds <= LONG_VIDEO_MAX_SECONDS
  );
}

/**
 * There is intentionally no Shorts quota: every useful transcribed Short may
 * pass. Ordinary 4–45 minute videos receive a ranking bonus, not a reservation.
 *
 * Owner mandate 2026-09-10: topic relevance (+15) requires a REAL explicit AI
 * signal (aiRelevant). dedicatedChannel is kept in the signature for call-site
 * stability but grants only the +45 curation/authority bonus, never relevance.
 */
export function scoreYoutubeCandidate(
  signals: YoutubeCandidateSignals,
): YoutubeCandidateDecision {
  if (!signals.hasTranscript) {
    return { eligible: false, score: 0, reason: "transcript-unavailable" };
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

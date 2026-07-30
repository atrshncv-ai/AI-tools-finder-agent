export type FailureStage = "fetch" | "extract" | "zen";

export interface ProcessingFailure {
  attempts: number;
  reason: string;
  lastFailedAt?: string;
}

export type ProcessingFailures = Partial<Record<FailureStage, ProcessingFailure>>;

const MAX_CONTENT_ATTEMPTS = 3;

export function nextFailureState(
  failures: ProcessingFailures,
  stage: FailureStage,
  reason: string,
  isYoutube: boolean,
): { attempts: number; reject: boolean } {
  const attempts = (failures[stage]?.attempts ?? 0) + 1;
  const definitiveYoutubeFailure =
    isYoutube && stage === "fetch" && reason === "youtube-transcript-unavailable";
  const exhaustedContentAttempts =
    (stage === "fetch" || stage === "extract") && attempts >= MAX_CONTENT_ATTEMPTS;

  return {
    attempts,
    reject: definitiveYoutubeFailure || exhaustedContentAttempts,
  };
}

# YouTube transcript-first ingestion — TDD evidence

## Source and journeys

Journeys were derived from the request to broaden YouTube coverage while only
publishing videos whose content can be verified:

- As a reader, I want useful long-form AI videos prioritized over low-context
  clips.
- As an editor, I want every video to pass a transcript preflight before score
  approval.
- As an editor, I want any number of useful transcribed Shorts to remain
  eligible without an artificial daily cap.
- As an operator, I want newly approved channels and both configured YouTube
  tabs collected reliably.
- As an operator, I want a Whisper transcript reused during summarization so a
  video is not transcribed twice.

## RED / GREEN report

| Guarantee | Test or command | Type | Result |
|---|---|---|---|
| Missing transcript produces an ineligible score-0 decision | `api/hermes/youtube-policy.test.ts` | Unit | PASS |
| A transcribed 4–45 minute video ranks above a transcribed Short | `api/hermes/youtube-policy.test.ts` | Unit | PASS |
| Ten useful transcribed Shorts all remain eligible | `api/hermes/youtube-policy.test.ts` | Unit | PASS |
| Four new channels use verified channel IDs | `api/hermes/youtube-sources.test.ts` | Unit | PASS |
| New sources include `/videos`; Ai.easylife also includes `/shorts` | `api/hermes/youtube-sources.test.ts` | Unit | PASS |
| TypeScript and shell orchestration remain valid | `npx tsc -b`; `bash -n` | Static | PASS |
| Existing behavior remains intact | `npx vitest run` | Unit/integration | 104/104 PASS |

RED was captured in commit `d8b486f`: both suites failed because the policy and
source registry did not yet exist. The same suites passed after implementation.

## Coverage and known gaps

The deterministic policy and source registry are covered directly. Live
YouTube caption availability, yt-dlp behavior, and production database writes
are verified during the server rollout because they depend on external YouTube
state and the configured production environment. Whisper remains disabled
until a compatible API key is configured.

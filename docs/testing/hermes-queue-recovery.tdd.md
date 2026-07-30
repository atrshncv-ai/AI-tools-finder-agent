# Hermes queue recovery — TDD evidence

## Source and journeys

Journeys were derived from the production incident diagnosed on 2026-07-30:

- As an operator, I want permanently unprocessable items to leave `pending`, so one bad batch cannot starve later news.
- As an editor, I want YouTube items without usable transcripts rejected before Zen summarization, so the dashboard never receives unsupported videos.
- As a reader, I want Nature pages to use their article body or abstract metadata, so accessible scientific content is not discarded as navigation noise.
- As an operator, I want Zen outages treated as transient, so good articles are not rejected because an external model endpoint is temporarily unavailable.

## RED / GREEN report

| Guarantee | Test | Type | Result |
|---|---|---|---|
| Missing YouTube transcripts reject immediately | `api/hermes/failure-policy.test.ts` | Unit | PASS |
| Ordinary content failures reject on attempt 3 | `api/hermes/failure-policy.test.ts` | Unit | PASS |
| Zen failures remain retryable | `api/hermes/failure-policy.test.ts` | Unit | PASS |
| Nature article-body selectors exclude navigation/references | `api/hermes/article-content.test.ts` | Unit | PASS |
| Nature metadata is used when the body is unavailable | `api/hermes/article-content.test.ts` | Unit | PASS |

RED was captured in commit `b82c83e`: both suites failed to import the intentionally
missing policy and extractor modules. GREEN was validated after implementation with:

```text
npx vitest run api/hermes/failure-policy.test.ts api/hermes/article-content.test.ts
Test Files 2 passed; Tests 5 passed

npx tsc -b
exit 0

npx vitest run
Test Files 9 passed; Tests 97 passed
```

## Coverage and known gaps

The pure decision and extraction branches introduced by this change are covered by
unit tests. Database mutation and the live shell/PM2 cycle are verified during the
production rollout because the repository has no isolated PostgreSQL integration
fixture. Zen availability is checked against the configured production key pool
without logging key values.

# Public repository sanitization — TDD evidence

## Source and journeys

Journeys were derived from the request to make the public repository safe to
share:

- As an owner, I want production hosts, paths, domains, and fixed credentials
  absent from tracked files.
- As an operator, I want deployment to fail when the database password is
  missing instead of using a weak default.
- As a maintainer, I want common secret artifacts ignored and a regression test
  that prevents sensitive values from returning.

## RED / GREEN report

| Guarantee | Test or command | Type | Result |
|---|---|---|---|
| Active env, private-key, log, and database files are not tracked | `api/security-sensitive-data.test.ts` | Security regression | PASS |
| Production infrastructure and fixed credentials are absent | `api/security-sensitive-data.test.ts` | Security regression | PASS |
| TypeScript remains valid | `npx tsc -b` | Build | PASS |
| Existing behavior remains intact | `npx vitest run` | Unit/integration | 99/99 PASS |
| Docker requires an explicit database password | `docker compose -p repository-validation config` | Configuration | PASS |
| Shell and PM2 configuration parse successfully | `bash -n`; `node --check` | Static validation | PASS |

RED was captured in commit `27dce03`: the regression test reported 13 tracked
files containing production infrastructure, fixed credentials, or a weak
database-password fallback. After sanitization the same test passed.

## Coverage and known gaps

The security regression covers the identified repository exposures and common
secret artifact filenames. Pattern-based scanning cannot prove that arbitrary
high-entropy secrets never existed. Historical commits still contain retired
values until a separately approved history rewrite and force-push is performed;
any credential that was ever public must be rotated independently.

# Evidence — 01 model runtime diagnosis

checked_at: 2026-09-24T09:40:03Z
scope: read-only; no production changes, restarts, deploys, deletes, resets, or credential output

## Required safe fields

- timestamp: `2026-09-24T09:40:03Z`
- effective_endpoint_host: `unknown`
- effective_endpoint_path: `unknown`
- configured_model_present: `unknown`
- catalog_model_present: `true` for `mimo-v2.5` and `mimo-v2.6-flash`
- probe_model_present: `unknown` (probe not run)
- classification: `BLOCKED`

## Access result

- `cntr-mvp` authenticated with SSH BatchMode, but no PM2/Node runtime was present and no target Go environment was observable. The only matching running service exposed by the host was an unrelated Uvicorn container.
- `factory` could not be used: SSH stopped at `Host key verification failed` before authentication. The host-key check was not bypassed.
- Actual production runtime, effective endpoint, configured model, key presence/length, PM2 state, and runtime markers therefore remain unverified.

## Safe production-surface facts

- Effective production endpoint: **unavailable/unknown** (no target process identified).
- `ZEN_GO_API_KEYS` / `ZEN_GO_API_KEY`: not observable in the reachable host process/container environment; no lengths recorded.
- `ZEN_GO_MODEL`: not observable on the reachable runtime; local source default is `mimo-v2.5`.
- PM2/log markers: unavailable (`pm2` and `node` absent on the reachable host); no runtime marker was claimed.
- Completion probe: **not run** because the target production environment/key was not available. No POST was sent.

## Catalog cross-check

- Endpoint: `opencode.ai` `/zen/go/v1/models`
- HTTP: `200` (`2xx`)
- Catalog parsed: 42 model IDs
- `mimo-v2.5`: present
- `mimo-v2.6-flash`: present
- `mimo-v2.6`: absent
- `hy3`, `glm-5.3-flash`, `deepseek-v4-flash`: present
- Catalog evidence does not prove that either model can complete a request with the production key/subscription.

## Local implementation cross-check (read-only)

- `app/api/ai/zenClient.ts:23-35,64-72,119-142` routes to the Go endpoint only when a Go key pool or legacy Go key is non-empty; the Go path uses one configured `ZEN_GO_MODEL` and does not automatically fall back to a legacy provider.
- The default Go base is host `opencode.ai`, path `/zen/go/v1`; completion appends `/chat/completions`.
- `app/api/ai/goModels.ts:14-45` and `app/api/ai/goModels.test.ts:102-215` agree on the local default/preference contract.
- `app/scripts/hermes/save-summary.ts:161-164,209-224` checks connectivity before summarization and records the Go model when Go is configured.
- Local concern (not changed): `app/api/ai/zenClient.ts:448-458,525-532` can place upstream error-body text into thrown/logged errors for non-2xx paths. No such text was read into this evidence.

## Classification and next action

- classification: `BLOCKED`
- cause: target production SSH/runtime is not available; the reachable authenticated host is not a verifiable instance of this TypeScript agent.
- confidence: high for the access blocker; none for the actual production model runtime.
- safe next action: restore trusted SSH access to the actual production host (or provide an existing read-only host alias), then repeat the one-probe read-only check. Do not change model/provider configuration or add fallback based on this incomplete evidence.

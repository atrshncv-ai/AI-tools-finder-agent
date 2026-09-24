# Evidence — 01 model runtime diagnosis

checked_at: 2026-09-24T09:44:14Z
scope: read-only; second and final SSH retry; no production change, process control, deploy, restart, delete, reset, or credential output

## Safe runtime discovery

| timestamp | host | path | safe result | fixed classification |
|---|---|---|---|---|
| 2026-09-24T09:44:14Z | `factory` | `unknown` | strict host-key verification stopped the connection before authentication; host-key policy was not bypassed | `SSH_HOST_KEY_CHANGED_STRICT_CHECK_FAILED` |
| 2026-09-24T09:44:08Z | `cntr-mvp` | `unknown` | SSH authenticated; `node_present=false`; `pm2_present=false`; `typescript_runtime_process_count=0`; `target_runtime_process_count=0`; `project_marker_present=false` | `NOT_TARGET_TYPESCRIPT_RUNTIME` |
| 2026-09-24T09:44:14Z | prior production host from repository context | `unknown` | direct strict `BatchMode` authentication was rejected; no configured production alias or non-guessed user was available | `SSH_AUTH_REJECTED` |

- target_runtime_path: `unknown`
- effective_endpoint_host: `unknown`
- effective_endpoint_path: `unknown`
- configured_model: `unknown`
- `ZEN_GO_API_KEYS_present`: `unknown`; `ZEN_GO_API_KEYS_length`: `unknown`
- `ZEN_GO_API_KEY_present`: `unknown`; `ZEN_GO_API_KEY_length`: `unknown`
- process_environment_inspected: `false`
- environment_file_contents_inspected: `false`
- completion_probe: `not_run_target_runtime_not_found`
- completion_http_class: `not_applicable`
- completion_model_id: `not_applicable`
- runtime_error_class: `TARGET_RUNTIME_UNREACHABLE`

## Catalog cross-check retained from the first safe check

- checked_at: `2026-09-24T09:40:03Z`
- endpoint host/path: `opencode.ai` / `/zen/go/v1/models`
- HTTP class: `2xx` (`200`)
- `mimo-v2.5`: `present`
- `mimo-v2.6-flash`: `present`
- `mimo-v2.6`: `absent`
- catalog_only_evidence: `true`
- completion_availability_proven: `false`

## Classification

- status: `BLOCKED`
- cause: `TARGET_RUNTIME_UNREACHABLE`
- cause_confidence: `high_for_access_blocker`; `unknown_for_model_runtime_failure`
- production_changed: `false`
- automatic_fallback_added: `false`
- safe_next_action: make the actual TypeScript production runtime reachable through an existing trusted host-key entry and read-only SSH alias, then repeat the single safe completion probe; do not change host-key verification, model/provider configuration, or production state.

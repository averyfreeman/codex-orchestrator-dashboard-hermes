---
title: HTTP API reference
description: Status endpoints and private dashboard control routes.
---

All routes are served by the self-hosted Next.js application. State-changing control routes require a same-origin dashboard request. The browser does not receive SSH credentials.

## Observation

| Method and path | Purpose | Response / boundary |
| --- | --- | --- |
| `GET /api/overview` | Collect the configured fleet and append a bounded snapshot | `{ checkedAt, hosts, resourceThresholds }`; host reports include numeric `resources` or `null`; `no-store` |
| `GET /api/logs` | Read the bounded recent local event window | `{ events }`; `no-store`; 7-day retention, at most 1,000 events / 1 MB |
| `POST /api/logs` | Ingest one event | Requires `LOG_INGEST_TOKEN` bearer auth; body max 10 KB; metadata identifiers and flat numeric metrics only; nested or free-text metric values are rejected |
| `GET /api/orchestrator` | Check Hermes API availability and planning-tool policy | Bounded status; never returns the API Server credential |
| `POST /api/orchestrator/plans` | `{ "intent": string }` plus `Idempotency-Key` | Ask the tool-disabled Hermes planning profile to draft a plan; returns a planning run ID |
| `GET /api/orchestrator/plans/runs/{runId}` | — | Reconcile a Hermes planning run without persisting its prompt or result |
| `POST /api/orchestrator/plans/runs/{runId}` | — | Stop the explicitly identified Hermes planning run |
| `POST /api/orchestrator/runs` | `{ "plan": object }` plus `Idempotency-Key` | Start metadata for an operator-reviewed, validated plan; refuses unsupported permission modes |
| `GET /api/orchestrator/runs/{runId}` | — | Read content-free worker run metadata for reconciliation |
| `POST /api/orchestrator/runs/{runId}/stop` | — | Cancel queued/blocked tasks and return saved active-worker IDs for best-effort interrupt requests |
| `PATCH /api/orchestrator/runs/{runId}/tasks/{taskId}` | `{ "status": "queued"\|"blocked" }` | Explicitly retry a task or mark a dependency-blocked task |

The overview `resources` object contains `cpuPercent`, `cpuCount`, `load1`, `memoryPercent`, `memoryTotalMb`, `memoryAvailableMb`, `diskPercent`, `diskTotalGb`, and `diskFreeGb`. Each field is numeric or `null`; missing platform counters are not reported as zero. `resourceThresholds` contains the resolved server-side warning thresholds.

## Control

| Method and path | Request | Purpose |
| --- | --- | --- |
| `GET /api/control/profile` | — | Read current dashboard-managed profile settings |
| `PUT /api/control/profile` | `{ "networkAccess": boolean }` | Set command networking and web search mode for subsequent turns |
| `POST /api/control/codex/turn` | `{ "host": string, "prompt": string, "cwd"?: string, "threadId"?: string, "runId"?: string, "taskId"?: string }` | Start/resume a selected-host turn; returns Server-Sent Events |
| `POST /api/control/codex/steer` | `{ "host": string, "threadId": string, "turnId": string, "prompt": string, "runId"?: string, "taskId"?: string }` | Add text to the exact active turn; prompt is not persisted by the dashboard |
| `POST /api/control/codex/interrupt` | `{ "host": string, "threadId": string, "turnId": string, "runId"?: string, "taskId"?: string }` | Request interrupt of one specific turn; orchestration IDs must be supplied together and match saved worker metadata |
| `POST /api/control/codex/recover` | `{ "host": string }` | Request fixed Codex daemon start only after server-side down check |
| `POST /api/control/codex-sync/plan` | `{ "sourceHostSlug": string, "targetHostSlugs"?: string[] }` | Inspect current state and return a ten-minute review plan with safe diffs and blocked items. If targets are omitted, use other reachable Codex hosts. This inspection does not write host state. |
| `POST /api/control/codex-sync/apply` | `{ "planId": string, "restartWhenFinished": boolean }` | Recheck source and target state, reject stale/expired plans, then start applying the reviewed plan; returns `202 { "runId": string }`. |
| `GET /api/control/codex-sync/runs/{runId}` | — | Read sanitized per-host progress and outcomes for a run. |
| `GET /api/control/herdr/sessions?host={slug}` | — | List sessions on one configured host |
| `POST /api/control/herdr/sessions` | `{ "host": string, "action": "start"\|"stop", "name": string }` | Start/stop one validated named session; `default` is protected |

Every host field must resolve against the private fleet inventory. Mutation routes reject requests from other origins. Prompt and live-steer input are capped at 40,000 characters. Turn start returns streaming events; interrupt and steer success indicate acknowledgement, not final turn status. Run stop cancels undispatched work and asks Codex to interrupt saved active turns; starting workers without IDs are interrupted when IDs arrive on a live stream where possible. Neither stop nor interrupt guarantees detached processes have ended.

The sync plan, apply, and run-status routes also require the local-origin guard. The plan contains reviewable, classified values and safe host labels; the private absolute `CODEX_HOME` override and secret values are not sent to the browser. Plan payloads and transfer content stay in process memory. Persisted run status contains IDs, versions, category outcomes, restart status, and counts.

Implementation links: [`src/app/api`](https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes/tree/main/src/app/api), [`control security`](https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes/blob/main/src/lib/control-security.ts), [`telemetry schema`](https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes/blob/main/src/lib/logging.ts).

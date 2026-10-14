---
title: Protocols and telemetry
description: Use Hermes for planning, Codex app-server for workers, and size bounded monitoring.
---

## Protocol selection

Use Codex app-server for native Codex threads and turns on a selected host. The protocol supports newline-delimited JSON-RPC over stdio; this dashboard uses the managed daemon’s host-local WebSocket control socket through `codex app-server proxy --sock`, carrying the bidirectional framed stream over strict SSH stdio. It does not expose the control socket on the network. Review the [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) and [method map](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs) when updating the bridge.

Hermes API Server drafts a plan with a dedicated profile that has no tools enabled. The dashboard validates the result and waits for explicit operator approval before creating a worker run. Codex app-server then owns each host-scoped thread and turn; Hermes is the planner, not the worker runtime.

## Metrics to consider

| Signal | Collection method | Token cost | Main resource cost |
| --- | --- | --- | --- |
| Host availability | One bounded probe per host and interval | None | SSH setup and a short remote command |
| CPU/load, memory, disk, uptime | Linux `/proc/stat` + `MemAvailable`; macOS `top` + `vm_stat`; home-volume `disk_usage` | None | Linux CPU sampling waits 200 ms; other collection is bounded OS reads |
| Codex turn state | App-server events and targeted thread reads | None to observe | One persistent proxy stream per actively observed turn |
| Token usage | App-server usage notifications | None to read | Small event parsing and metadata storage |
| Herdr workspace/agent state | Named-session CLI list/start/stop implemented; event subscription and snapshot recovery outstanding | None to observe | Bounded CLI query today; event-stream overhead remains unmeasured |
| Process CPU/RSS | Host process summaries implemented; verified worker-owned child metrics outstanding | None | Bounded remote process query; ownership must not be inferred from names |
| Hermes planning | API run and status reconciliation | Model-dependent | One planning run per reviewed request; planning tools disabled |
| Agent work | Codex worker turn or Herdr agent | Model-dependent | Usually the dominant CPU, RAM, and token cost |

At a polling interval of `I` seconds, the rough probe rate is `host_count × 60 / I` probes per minute. Five hosts polled every 30 seconds produce about 10 probes/minute. Stagger probes, bound their timeout/output, and use event streams for live turn/session state rather than polling full transcripts.

Resource warnings default to CPU at or above 75% for 60 seconds, memory at or above 80%, and home-volume disk at or above 80%. CPU uses consecutive samples and resets after a gap greater than 60 seconds. Threshold overrides are server-side environment values listed in the [configuration reference](../reference/configuration/).

There is no portable vendor benchmark for this gateway and host mix. Measure gateway and remote CPU/RSS with monitoring disabled and enabled at the target interval, then measure again during one representative active turn. Include probe duration, timeouts, event volume, and actual turn token usage. Observation itself does not invoke a model; only the underlying agent work incurs model usage.

Terminal orchestration runs expire seven days after `completedAt`; unfinished runs stay retained. Operational events and numeric resource samples have a separate seven-day limit and a 1,000-event / 1 MB cap, so they can expire earlier. The run store does not share that cap. Separate 30-day aggregate telemetry and 90-day content-free approval-decision stores are outstanding requirements, not shipped storage. The approval audit depends on the exact one-time approval bridge, which is also unimplemented. `POST /api/logs` accepts flat numeric metrics only—no nested objects or free-text values. The collector excludes prompts, transcripts, terminal output, credentials, and process environment variables. Keep private operational data owner-only.

# Interactive control and telemetry options

**Status:** Architecture research for the dashboard. Hermes drafts plans, the operator reviews them, and Codex app-server runs the selected-host workers. Herdr named-session lifecycle controls remain separate. Sources below are upstream product documentation, protocol specifications, or source schemas, reviewed 2026-10-07.

## Recommendation

Keep worker control host-scoped. The browser selects a reviewed task and host; the dashboard backend connects to that host’s Codex app-server, starts or steers a turn, and streams app-server events back to the browser. A same-origin API check protects mutations; the dashboard is intended for private LAN and overlay access only.

Use the native Codex app-server protocol for Codex work, and Herdr’s own session interface for Herdr lifecycle controls. Hermes plans and coordinates work but is not the worker runtime.

Keep dashboard start/stop controls to **Codex turns** and **Herdr sessions**. Do not expose app-server daemon lifecycle or arbitrary remote shell/process controls in this dashboard.

## Interaction model

### Codex chat and turn controls

Codex app-server is already a bidirectional JSON-RPC interface for rich clients. Its primitives are threads, turns, and turn items; the app-server emits notifications while a turn runs. The current protocol includes thread start/resume/list/read and turn start/steer/interrupt operations, so a per-host chat composer and live progress view are a natural fit. [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) · [protocol method map](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs)

Use one stable app-server connection for a host/profile and multiplex its thread activity through the dashboard API. The turn/interrupt request is tied to a specific thread and turn; show the active turn and target clearly before stopping it. Model turn states explicitly (inProgress, completed, interrupted, failed). [Turn API and status types](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/turn.rs)

Do not treat closing a browser tab or losing SSH as proof that a turn stopped. Reconnect and read the authoritative app-server thread/turn state. Avoid starting a separate app-server for every task: independently launched app-server processes have separate live status and approval state.

For remote transport, use only configured SSH routes with strict host-key checking, keep app-server on the host, and carry its local control stream through the host proxy. Codex app-server’s default stdio transport carries newline-delimited JSON-RPC. [Codex app-server protocol and transports](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

Dashboard-managed Codex profiles should apply the settled operator policy: auto-approve eligible dashboard-initiated tool actions, set $HOME as the writable root, and enable command network access by default with a per-profile dashboard off switch. Codex command networking (`sandbox_workspace_write.network_access`) and built-in web search (`web_search`) are separate controls. The dashboard switch should set both together: on means command networking plus live web search; off disables command networking and web search. Approval policy and sandbox/network policy are also separate: `approval_policy = "never"` suppresses eligible command approval prompts while retaining the configured sandbox. It does not grant access to unrelated apps, MCP servers, browser traffic, or operating-system permission prompts. Apply changes to subsequent turns; an already-sent network request cannot be recalled. This is an operational recommendation; exact live-update behavior depends on how the dashboard applies the profile. [Codex sandbox configuration](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/config.rs) · [Codex approval and sandbox definitions](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) · [Codex approvals and web-search configuration](https://learn.chatgpt.com/docs/agent-approvals-security)

This is an unattended, high-trust profile: an approved Codex tool can act on files under $HOME and use outbound network access while enabled. Keep that profile distinct from read-only observation, display the selected host/profile and current network setting in the composer, and log actor, host alias, thread/turn IDs, policy, timestamps, result, and token counts. Keep prompts, terminal output, environment values, and credentials out of dashboard logs by default.

### Herdr sessions

Use Herdr’s named-session lifecycle rather than treating each pane or foreground process as a dashboard job. Its CLI supports listing, attaching, starting/attaching a named session, and stopping a named session; the CLI communicates with the running server through Herdr’s local socket API and supports JSON output. [Herdr CLI reference](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/cli-reference.mdx)

For richer status, subscribe to Herdr events and bootstrap/recover with session.snapshot. Events cover live workspace/tab/pane/agent changes; the snapshot is authoritative current state, not durable history. If an events_lost notification arrives, resubscribe and reconcile from a fresh snapshot. pane.process_info can report shell PID, foreground process group, and foreground process PID/name/arguments/cwd when the platform exposes them; it does not report CPU or RSS. [Herdr socket API](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/socket-api.mdx)

A Herdr “stop” is materially different from detaching a client: detached panes keep running, while a stopped named session ends that session’s panes and runtime. Show the selected session name and its pane count before stopping; don’t offer a bulk “stop all” action. [Herdr CLI reference](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/cli-reference.mdx) · [Herdr named session lifecycle](https://herdr.dev/docs/persistence-remote/)

The socket API also exposes pane input and agent prompt/start operations, but they broaden the surface into arbitrary terminal interaction. Keep those out of the initial control scope; start/stop named Herdr sessions and observe their event/status state first.

## Metrics and operating cost

| Signal | Collection path | What it adds | Cost profile |
| --- | --- | --- | --- |
| Host health | Bounded SSH probes: sampled CPU/load, available/total memory, home-volume free/total space, process count, OS/runtime versions | Capacity and “host is alive” context beyond app status | No model tokens. Linux CPU sampling waits 200 ms; other collection is one short command per host per interval. Measure on the actual hosts. |
| Codex activity | App-server events/thread reads: thread, turn, state, model/profile, timestamps, approval events | Live turn progress and stale/running/failed distinction | No model call to observe; one persistent RPC stream plus small event payloads. Do not poll full transcripts. |
| Codex usage | ThreadTokenUsageUpdatedNotification: last/total input, cached input, cache-write input, output, reasoning output, total, and context window | Usage per turn/thread and trend reporting | Reading usage adds no inference tokens. Chat/delegation do. Convert tokens to money only when the provider’s billing mode and model price are known; the OpenAI API pricing table is not a reliable estimate for a ChatGPT plan. [Usage schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadTokenUsageUpdatedNotification.json) · [API pricing](https://developers.openai.com/api/docs/pricing) |
| Herdr activity | Event subscription + periodic/reconnect snapshot; pane process metadata | Agent state, workspace/pane counts, foreground process identity | Event-driven status avoids frequent polling. Snapshot recovery is bounded work; no model tokens. |
| Hermes planning | Hermes API run and status reconciliation | Proposed task graph and worker instructions | Model-dependent; planning profile must have no enabled tools |
| Agent work | Codex worker turn or Herdr agent | Actual code/agent execution | Usually the token and remote CPU/RAM cost center; usage depends on the model and provider |

As a planning heuristic (not a vendor limit), interval polling produces approximately **host_count × 60 / interval_seconds** probes per minute. Prefer 30–60 second health probes plus event streams for live app state; stagger probes and cap command output/timeouts. Each remote process doing actual work can use much more CPU/RAM than the collector, and Herdr panes intentionally keep detached processes running. Vendor docs do not publish a transferable CPU or memory benchmark for this deployment; capture a baseline, then compare gateway and host CPU/RSS with telemetry disabled and enabled at the intended interval.

Codex’s optional server/diagnostics method is marked experimental and described as content-free, process-local diagnostics. It could enrich Codex health later, but don’t make the dashboard depend on it until its schema/support level is stable. [Codex experimental diagnostics method](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs)

## Hermes and Codex responsibilities

Hermes API Server receives the planning request and returns a plan run identifier. A dedicated planning profile with no enabled tools prevents the planner from dispatching or altering workers. The dashboard validates and displays the returned plan; only the operator's explicit Run action creates an orchestration run.

Each worker is a Codex app-server thread/turn on one inventory-listed host. The run store retains identifiers and state only. Live steer sends additional text to the stored active turn ID; it does not start a replacement turn. Disconnects become stale observations and never trigger automatic restart or duplicate dispatch. See the [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) and [turn API](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/turn.rs).

## Rollout and limits

1. Codex thread/turn start, streaming state, interrupt, and per-turn usage are implemented; keep the selected host visible throughout.
2. Herdr named-session listing/start/stop is implemented; add event-driven state with snapshot recovery.
3. Keep host health probes bounded and staggered with output/timeout limits.
4. Complete the exact one-time approval flow before enabling tasks that require permissions beyond the home-scoped V1 policy.
5. Benchmark resource use under idle monitoring and one representative active turn/session. Track gateway RSS/CPU, remote collector RSS/CPU, probe duration, event volume, and actual agent token usage. The dashboard now reports sampled host CPU/load, memory, and home-volume disk; use the 30-second metrics to compare idle and active-work baselines.

The Codex managed app-server daemon is a separate, explicitly experimental lifecycle interface; restarting/stopping it can interrupt active or queued work. It is intentionally outside the dashboard’s start/stop surface. [Codex app-server daemon lifecycle](https://github.com/openai/codex/blob/main/codex-rs/app-server-daemon/README.md)

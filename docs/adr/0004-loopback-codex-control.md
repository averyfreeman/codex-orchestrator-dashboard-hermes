# Codex control uses a scoped dashboard bridge

## Context

The observation dashboard needs a scoped control path to each selected host's Codex app-server, including streaming output, live steering, interruption, token usage, configured SSH routes, and a default-on network switch. The request must not expose a general remote shell or change the host's unrelated Codex configuration.

## Decision

The dashboard launches a narrow Python bridge that connects to the host's existing managed app-server through `codex app-server proxy`. Remote connections use only configured SSH routes in inventory order with batch mode and strict host-key checking. The browser selects a host and sends a prompt through a same-origin API. The bridge issues only the app-server methods needed for initialize, thread/turn lifecycle, live steering, interruption, and scoped request responses.

Each dashboard thread/turn receives explicit settings: `gpt-6-luna`, maximum reasoning effort, `approvalPolicy = never`, `workspace-write`, and the selected host user's `$HOME` as the only writable root. `Dashboard default` network access begins enabled; one persisted toggle controls both sandbox command networking and live web search for subsequent turns. Shared host `config.toml`, authentication, and fleet-synced profiles are untouched. Unexpected permission expansions beyond `$HOME` or beyond the network switch are denied.

The dashboard is available only on private LAN and overlay interfaces, and control mutations require the same dashboard origin. The service is not intended for public exposure.

## Consequences

The selected host's persistent app-server owns thread and turn history; the dashboard stores only profile preference and bounded metadata. The gateway streams assistant text and limited activity/usage events but never writes prompts, transcripts, or terminal output to JSONL telemetry. Closing the browser or SSH stream is not treated as turn cancellation; the operator must use the explicit interrupt action and reconcile terminal state. Hermes planning, Codex worker turns, and Herdr named-session control remain distinct paths.

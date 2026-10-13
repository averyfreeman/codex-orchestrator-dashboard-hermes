# Selected-host control uses native runtime interfaces

## Context

The dashboard needs to move from observation to coordinating Codex and Herdr work without turning into a general remote shell. Codex app-server owns Codex threads and turns; Herdr owns persistent named terminal sessions. Hermes drafts the task plan, while Codex remains the worker runtime.

## Decision

Use the selected host’s Codex app-server protocol for Codex thread/turn start, streaming, steering, and interruption. Use Herdr’s named-session interface for Herdr session lifecycle actions. Hermes may draft dependency-aware plans, but the operator reviews and starts every run. Tunnel host-local app-server transport over the configured strict SSH route, trying ZeroTier before Tailscale.

## Consequences

The dashboard can present native thread and turn state and can interrupt or steer a specific active turn. The selected host and worker identifiers remain visible for each operation. Loss of a browser or SSH connection is reconciled from runtime state rather than treated as cancellation. Recovery is limited to one fixed Codex daemon `start` action after a fresh probe confirms the daemon is down. The dashboard does not restart a responding daemon, expose arbitrary SSH, or provide service-manager controls.

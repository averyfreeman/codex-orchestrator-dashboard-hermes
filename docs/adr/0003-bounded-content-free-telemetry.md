# Telemetry stays bounded and content-free

## Context

The dashboard needs useful capacity, health, activity, and cost signals without duplicating conversations or collecting terminal contents. Polling too often adds remote process overhead and produces little value once native event streams are available.

## Decision

Collect host status, load/memory/disk, process CPU/RSS, versions, aggregate counts, Codex turn state and token-usage totals, Herdr event metadata, and worktree metadata. Use a 30-second host-health poll and event streams for interactive status, with a bounded snapshot after reconnect. Keep run/resource metadata for seven days after terminal status (unfinished runs remain retained), aggregate telemetry for 30 days, and content-free approval decisions for 90 days. Operational logs have a separate seven-day bound with count and byte caps. Exclude prompts, transcripts, terminal output, secrets, and process environments.

## Implementation status — 2026-10-14

Host probes, Codex event projection, numeric resource samples, and content-free run state are implemented. `src/lib/orchestration-store.ts` prunes terminal runs seven days after `completedAt`, retaining unfinished runs. `src/lib/logging.ts` retains operational events and resource samples for at most seven days, capped at 1,000 events / 1 MB; this cap does not apply to the separate run store.

The separate 30-day aggregate store and 90-day approval audit store are not implemented. The approval audit depends on an exact, one-time worker approval bridge, also outstanding. Herdr currently supports named-session CLI listing/start/stop, not event subscription or snapshot recovery. Worker-owned process tracking, per-worker CPU/RSS, and representative monitoring benchmarks remain outstanding. These are accepted requirements; this status amendment does not defer or remove them.

## Consequences

Observation itself makes no model calls. Agent execution remains the token and compute cost center. The collector must cap time and output and be benchmarked on the gateway and slowest host. The dashboard can show usage and activity without retaining conversation content.

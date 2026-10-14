---
title: Use Codex and Herdr controls
description: Review Hermes plans, steer Codex workers, and manage named Herdr sessions.
---

## Codex conversation

The Control view requires an explicit host. Its first prompt creates a thread; later prompts in that view continue using the returned thread ID. The API also accepts an explicit `threadId` to resume a known thread. The view streams assistant text and activity updates and shows turn state and usage notifications. The browser’s connection is not the turn’s lifetime: if the page or SSH stream closes, the remote turn may continue. Reconnect and reconcile with app-server state before assuming the turn ended.

Interrupt targets one explicit thread and turn. The API reports that the request was acknowledged; the app-server’s terminal event is authoritative about whether the turn completed, failed, or was interrupted.

Prompts and replies are delivered to the selected host’s Codex thread. Telemetry records identifiers, policy, result, timing, and usage metadata, but does not include prompt or terminal contents.

## Herdr named sessions

Select a host to list its named sessions. Start and stop actions are scoped to a validated session name. The protected `default` session cannot be stopped through the dashboard. Stopping a named session ends that session’s panes and runtime; detaching a client does not.

Herdr event subscriptions and snapshot recovery are not implemented. A disconnected listing is an unknown observation, not evidence that a session stopped.

## Hermes orchestration

Hermes drafts the plan; it does not start workers. The operator reviews the dependency graph, host assignments, working directories, permission modes, and Codex worker prompts before selecting **Run reviewed plan**. Tasks needing permissions beyond the supported home-scoped policy are blocked until the exact one-time approval flow is available.

Queue is the default per-worker mode. Select **Live steer** to add text to the active Codex turn; the request is bound to the worker's saved thread and turn IDs. Steering text is not stored in dashboard run metadata.

Stopping a worker interrupts its saved Codex thread/turn and reconciles Codex-tracked background terminals only. Detached or untracked descendants are not proven cleared; complete worker-owned child tracking and per-worker resource metrics remain outstanding. Reconnect currently resumes one retained run by ID; a bounded run-history list is not available.

The dashboard does not provide arbitrary SSH commands, general process termination, bulk session shutdown, or general app-server restart controls. Codex sync has a separate opt-in, guarded post-apply restart attempt for affected managed daemons; see the [sync walkthrough](../codex-sync/) for its idle checks and deferred outcomes.

See the [HTTP route reference](../../reference/api/) for request shapes and local-origin requirements.

---
title: Operate fleet views
description: Interpret host health, Hermes runs, Herdr, Treehouse, and telemetry views.
---

## App-server fleet

The overview reports whether a host responds, Codex version and Remote Control state, loaded thread count, selected SSH transport, configured address fields, and host CPU/load, memory, and home-volume disk capacity. Missing resource readings display as unknown, not zero. CPU warns only after the threshold is sustained across consecutive samples; memory and disk warn immediately at their configured thresholds. An unavailable host means the configured probes did not establish that the app-server is responding; it is not proof that the operating system is powered off.

The fleet collector polls every 30 seconds. Manual refresh runs the same bounded collection. Linux and macOS expose CPU and memory through different OS counters; unsupported readings remain unknown. SSH output is parsed into a sanitized report; raw command output, environment variables, prompts, transcripts, and terminal content are not returned to the browser.

Codex sync is a separate on-demand workflow. It reads the selected source and targets only when you request a plan; fleet polling never creates a plan or changes host state. See the [Codex sync walkthrough](../codex-sync/) for the review and apply steps.

## Herdr and Treehouse

The Herdr view summarizes daemon state, version, startup state, workspaces, agent metadata, and process CPU/RSS when the operating system reports it. These are process and agent metadata only; the dashboard does not read pane terminal output.

The Treehouse view lists registered worktree names, paths, and creation times from state files. A zero count means no registered state files were found; it does not establish whether Treehouse is installed.

## Hermes runs and logs

Hermes proposes a validated task graph; it does not dispatch workers. Review each host assignment and worker prompt before starting a run. Queue is the default worker mode; Live steer is optional and targets the active thread and turn IDs. The dashboard stores run metadata, not plan prompts, worker prompts, replies, or tool output. After a disconnect, active work is reconciled by saved IDs and is not restarted automatically.

The logs view reports operational telemetry, including flat numeric per-host resource samples retained for up to seven days and bounded by 1,000 events / 1 MB. Treat it as private operational data and keep prompts, transcripts, and tool output out of dashboard telemetry.

## Read failures carefully

When a host is unavailable, inspect the reported transport and then validate SSH reachability and host-key setup from the gateway host. The dashboard does not offer a general SSH terminal or arbitrary service-manager commands. See [recovery behavior](../recovery/) before using the daemon start action.

Source: [`src/lib/collector.ts`](https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes/blob/main/src/lib/collector.ts), [`scripts/probe.py`](https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes/blob/main/scripts/probe.py).

---
title: Profiles and permissions
description: Understand the dashboard-managed Codex profile and its network switch.
---

## Dashboard-managed profile

The default dashboard profile uses `gpt-6-luna` with maximum reasoning effort, `approval_policy = "never"`, a `workspace-write` sandbox, the host user’s home directory as a writable root, and network access enabled. The dashboard sends request-scoped profile settings when it starts or resumes a thread and starts a turn.

This is a high-trust unattended profile. Eligible tools can read or change files under that host user’s home directory and, while enabled, use sandboxed command networking and live Codex web search. `approval_policy = "never"` suppresses eligible approval prompts; it does not enlarge the sandbox or grant independent connector, browser, or operating-system permissions.

Shared host defaults are separate: the fleet profile installer now sets `gpt-6.1-sol` with medium reasoning effort. Named profiles retain their overrides. The dashboard bridge continues to request Luna/max for its workers; changing shared host defaults does not change that worker policy.

Tasks requesting privilege or filesystem access beyond the home boundary remain blocked. The exact one-time Hermes approval bridge and its 90-day decision audit are outstanding requirements, not available controls.

## Network switch

The per-profile **Network access** switch starts on. When on, the next turn receives command-network access and live web search. When off, both are disabled on subsequent turns. Changing the switch cannot retract a request that was already sent.

The profile preference is stored locally in `.dashboard-state/` with owner-only permissions. It is not a fleet-wide policy service. The host/profile is explicit in the UI, and the app-server remains the authority for turn lifecycle state.

## Local boundary

The dashboard is served only on the configured private LAN and overlay interfaces. Same-origin validation protects control mutations against cross-origin requests; it is not user authentication. Keep access restricted to trusted operators on those private networks and do not expose the dashboard to the public Internet.

The API allowlists host IDs and operations, rejects out-of-home file permission requests, and does not expose arbitrary remote shell execution. Keep the private inventory, SSH credentials, `.env.local`, and telemetry on the gateway host.

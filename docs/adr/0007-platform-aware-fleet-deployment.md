# Platform-aware fleet deployment uses verified artifacts and host-owned variants

## Context

ADR 0006 restricted portable configuration to scalar defaults and local package transfers to small files. That could not reproduce MCP definitions or native plugins. A private inventory copied from another gateway could also attribute local inspection to the wrong host. Provisioning still selected an older model baseline.

## Decision

Retain the review, freshness, same-origin, and managed-idle-restart boundaries from ADR 0006. Add an explicit `lan` SSH transport; the private inventory controls route order and stable trusted key aliases. Inventory identity records include hostname, operating system, and architecture. Reject mismatches before sync operations, and reject a local inventory whose identity differs from the gateway. Health collection also rejects mismatched identities.

A private, ignored deployment manifest declares the pinned CLI release, host plugin subsets, exclusions, source provenance, dependency versions, platform artifacts, and approved Ubuntu profile variants. Browser plans show exclusions, native adoption, staging requirements, dependency prerequisites, and retained host differences. A manifest change invalidates an outstanding plan. Source package hashes include native files and executable metadata even when JSON transfer is blocked.

Classify selected MCP fields and worker/manager role declarations explicitly. Normalize the real user's home for comparisons and expand it on the destination. Keep app-generated environment, auth, trust, notifications, unrelated user skills and extra profiles, and unrelated settings host-owned. Plugin skill trees travel in the approved release artifacts. Use reviewed per-host Ubuntu variants for execution routes and privileged executable paths. Do not show private Ubuntu route arguments in browser differences. Profiles remain real top-level config layers, including role layers.

Keep the small-file JSON limit. Native packages and dependency inputs use deterministic SHA-256 addressed archives under the user's fleet build directory. Stream local checksum calculation and transfer files through configured strict SCP routes. Recheck identity before staging and verify the checksum before extraction. Reject traversal, links in incoming archives, special files, oversized expansion, excessive entries, and credential-named input. Materialize source links only when they resolve to regular files within the selected source tree. Extraction is temporary, then atomic; preserve only owner read/write and owner executable metadata. Repeat runs validate staged file content, not just a marker.

Host-side activation uses fixed package-manager and Codex marketplace recipes. No browser-supplied command or destination path is accepted. Native binaries are built from captured sources with pinned compatible toolchains; dependencies are installed on the destination. Installed package content and executable metadata must match the approved artifact before the plan reports adoption. Config writes retain TOML validation, narrow classification, private backups, and atomic replacement.

If a managed restart times out after stopping an idle daemon, attempt bounded down-only start recovery. Active turns, unknown activity, or an unmanaged service still defer restart. Never change remote-control registration, credentials, sudoers, or external account state as part of convergence.

## Consequences

Host-specific paths and native application integrations can coexist with a shared capability baseline. Large artifacts no longer need inflated JSON limits, and native executable permissions survive deployment. External HTTP authentication and active daemon sessions can remain explicit adoption blockers after files are installed. Rebuilding a platform artifact or changing a host variant requires a new reviewed plan.

The manifest, archives, and sanitized operational evidence are private deployment data and are excluded from public snapshots. Build recipes and validation code remain reviewable in the repository.

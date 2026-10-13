# Plan: Unblock the migration plan and ADRs

## Goal
Give the user a low-effort way to ratify the implemented V1 boundaries or preserve the original stronger requirements, then reconcile the migration plan, architecture, ADRs, and canonical GitHub specification without inventing safety decisions.

## Current context / assumptions

- The migration plan is `.hermes/plans/2026-10-13_023454-hermes-orchestration-migration.md`. Its execution status still marks the one-at-a-time architecture grill and ADR/spec/ticket graph as pending, even though substantial code and local tests now exist.
- The plan’s original requirements and the implemented behavior differ in safety-relevant ways:
  - The original plan asks for reliable ownership and termination of worker-launched child processes, including children that outlive a Codex turn. The implementation only reports cleanup of Codex-tracked background terminals; it does not promise to terminate detached or untracked descendants.
  - The original plan describes a per-worker approval override and a channel bridge for privileged or out-of-`$HOME` actions. The implementation fails closed for tasks needing expanded permissions; no Codex approval bridge exists.
  - The architecture rollout still calls for Herdr event subscriptions with snapshot recovery. Named-session list/start/stop exists; event-driven status does not.
  - There is no run-history list/archive API; metadata retention is seven days and the browser keeps a single resume hint.
  - Live Hermes planning, Codex dispatch/steer, and GitHub Actions have not been verified end-to-end.
- `docs/adr/0001-selected-host-control.md` through `docs/adr/0006-codex-fleet-sync.md` already record selected-host control, managed profiles, telemetry, loopback control, Herdr session controls, and Codex fleet sync. Do not write duplicate ADRs for those decisions.
- The user explicitly directed removal of all OpenSpec documents. The entire `openspec/` directory, including the other active proposals, was removed before a GitHub spec issue was verified. Deletion does not accept any proposal's requirements; do not recreate OpenSpec documents.
- `docs/agents/issue-tracker.md` names GitHub Issues as the canonical spec/ticket tracker. The migration plan records no verified parent-spec issue number. Do not create or edit a GitHub issue until the user approves its body.
- Settled decisions must not be re-asked: private LAN/ZeroTier/Tailscale exposure, V1 Codex workers, `$HOME` Home Mode, review followed by explicit Run, Queue as the new-worker default, seven-day metadata retention, no prompt/transcript/tool-output telemetry, and no public-Internet exposure.
- This is a documentation decision-closure task. Do not change application code, dispatch a worker, contact a host, create/edit/delete a GitHub issue, or commit/push until the user selects a path and authorizes the relevant follow-up.

## Architecture / proposed approach
Use a decision gate rather than continuing to ask about already-settled details. Recommend treating the current, tested behavior as V1 and documenting its limits as explicit deferrals; if the user requires the original stronger process-containment or approval guarantees, keep the plan open and split those into separate design/implementation work before accepting the ADRs. ADRs should record only durable decisions, while the GitHub issue remains the single canonical specification.

## Step-by-step tasks

### 1. Ask the user to choose a completion path (2 minutes)

Present these options and accept a mixed answer by item:

**A — Recommended: ratify the current implementation as V1, with explicit deferrals.**

- Keep Hermes as a no-tools planner; the operator reviews the plan and presses Run; Codex app-server threads/turns are the V1 workers.
- Keep the `$HOME` boundary. Do not implement an approval bridge in V1; tasks requiring privilege or paths outside `$HOME` stay blocked.
- Promise only exact saved-worker interrupts and cleanup of Codex-tracked terminals. Never kill the shared app-server or claim detached/untracked descendants stopped.
- Keep Herdr named-session list/start/stop; defer event subscriptions and snapshot recovery.
- Keep seven-day metadata retention and the current single resume hint; defer a run-history/archive UI/API.
- Treat live Hermes/Codex verification as an external release gate requiring a designated test environment and an operator-approved Run.

**B — Preserve the original stronger requirements before accepting V1.**

Keep the plan open until there is a reviewed design and test seam for (1) exact one-time permission grants, including who can approve and how grants bind to a request/worker/host/action/expiry, and (2) reliable worker-owned child-process tracking and termination across turn completion, reconnect, and dashboard restart. Add Herdr events and run history only if the user explicitly includes them in this path.

Ask the user to reply `A`, `B`, or `A except: <items>`. Do not treat silence as approval.

### 2. Reconcile the migration plan against the selected path (5 minutes)

Edit only `.hermes/plans/2026-10-13_023454-hermes-orchestration-migration.md` after the user chooses:

- Replace the stale pending-grill statement with a decision record that distinguishes **implemented**, **accepted V1 limitation**, **deferred**, and **not live-verified**.
- For path A, explicitly defer the approval bridge, stronger child-process guarantees, Herdr event streaming, and run history; do not mark those requirements complete.
- For path B, leave the relevant decisions open and add separate design gates; do not present the current behavior as satisfying the original requirements.
- Keep live-service and GitHub Actions verification marked “not run” until actually exercised.

Verify formatting with:

```bash
git diff --check
```

Expected: exit 0 and no output.

### 3. Draft only the missing ADRs and amend existing permission decisions (5 minutes per ADR)

For path A, use the existing short format (`Context`, `Decision`, `Consequences`) and create:

- `docs/adr/0007-hermes-planning-codex-worker-boundary.md`: Hermes planning profile has no enabled tools; it drafts only; reviewed plans require explicit Run; V1 workers are Codex app-server threads/turns; run, planning, thread, and turn IDs remain distinct; no silent fallback or auto-retry.
- `docs/adr/0008-codex-worker-lifecycle-and-stop-guarantees.md`: disconnect means stale observation, not cancellation; stop acts only on saved exact worker IDs; queued work is canceled; tracked-terminal cleanup is best-effort; detached/untracked descendants are not guaranteed stopped; never kill the shared app-server.
- Amend `docs/adr/0002-dashboard-managed-profiles.md` and `docs/adr/0004-loopback-codex-control.md` to say explicitly that V1 has no out-of-home/privilege approval bridge and fails closed for requests outside the `$HOME` policy. Do not create a separate permissions ADR that repeats these decisions.

For path B, do not write accepted ADRs for the unresolved guarantees. First produce reviewed design options and tests as separate work; keep the migration plan open until the user accepts them.

Before assigning numbers, run:

```bash
printf '%s\n' docs/adr/*.md
```

Expected before the new ADRs: the existing numbered ADRs end at `0006-codex-fleet-sync.md`; no number may be reused.

### 4. Align the architecture and protocol research with accepted limits (5 minutes)

For path A, update the relevant sections of `docs/architecture.md` and `docs/research/interactive-control-options.md`:

- State the actual stop/cleanup guarantee, not the original stronger aspiration.
- Mark out-of-home approval, Herdr event streaming/snapshot recovery, and history/archive as deferred, not implemented.
- Preserve the existing private-network, `$HOME`, content-free telemetry, and explicit-Run decisions.

For path B, keep these requirements listed as unresolved design gates; do not write text that implies they exist.

### 5. Review or create the one canonical GitHub specification (user approval required) (5 minutes)

After the user approves the ADR/spec text, inspect the issue tracker; do not create a duplicate parent issue:

```bash
gh issue list --repo averyfreeman/codex-orchestrator-dashboard-hermes --state all --limit 100 --json number,title,state,url
```

Expected: JSON issue records. Identify any existing Hermes orchestration parent issue by title and body; if one is already accepted, read it with:

```bash
gh issue view "$SPEC_NUMBER" --repo averyfreeman/codex-orchestrator-dashboard-hermes --json number,title,body,labels,comments
```

If none exists, draft the agreed body for user review using the required sections from `docs/agents/issue-tracker.md` and the migration plan (problem, solution, user stories, implementation/testing decisions, out of scope, further notes). Create it only after approval, label it `ready-for-agent`, capture the returned number, and read it back with the command above. Expected: the returned issue body matches the approved decisions and has the required label. Do not create tickets or dependency edges until that read-back is approved.

### 6. Record and verify the already-completed OpenSpec document removal (2 minutes)

The user explicitly requested removal of all OpenSpec documents before a canonical GitHub issue was verified. Do not recreate the OpenSpec directory. Verify the exact target is absent:

```bash
test ! -e openspec
```

Expected: exit 0, confirming no OpenSpec documents remain in the repository.

### 7. Validate and hand off for review (5 minutes)

For documentation-only changes, no code tests are added. Run:

```bash
git diff --check
PATH="$HOME/.local/bin:$PATH" npm run docs:check
PATH="$HOME/.local/bin:$PATH" npm run docs:build
```

Expected: `git diff --check` prints nothing; `docs:check` reports 0 errors, 0 warnings, and 0 hints; `docs:build` exits 0 (the existing `docs → 404` warning is known and should be reported, not concealed). Read the final ADRs, architecture sections, migration-plan status, and canonical issue side by side; confirm none claim unverified live behavior. Do not commit or push unless the user separately authorizes it.

## Tests / validation

- This plan contains no code changes; TDD is not applicable to the documentation-only decision closure.
- If path B leads to code work, create separate implementation tickets with exact test seams and follow RED → GREEN → regression tests → refactor. Do not start that code work under this plan.
- The local docs checks above validate syntax/build only. They do not substitute for the external live Hermes/Codex test gate or a GitHub Actions run.

## Risks, tradeoffs, and open questions

- Path A makes the plan and ADRs finishable now, but deliberately narrows V1 relative to the original approval-bridge and child-process guarantees. The deferred scope must remain visible so “done” is not overstated.
- Path B preserves the original guarantees but cannot be closed by documentation alone; it requires a safe approval design, reliable per-worker process ownership, test hosts, and an operator-approved live dispatch.
- All OpenSpec documents were removed before canonical issue approval at the user's direction. Carry forward only decisions the user accepts; do not restore the directory or treat the deleted proposals as authoritative.
- The repo instructions make GitHub Issues canonical. Changing that policy is a user-level choice; do not silently switch to OpenSpec or make the plan file a second accepted specification.
- A live test needs a designated Hermes API Server and Codex app-server/host. A real worker must not be started without an operator reviewing the plan and explicitly pressing Run.
- User response needed to proceed with final plan/ADR wording: `A`, `B`, or `A except: <items>`.
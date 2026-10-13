# Plan: Remaining work for Hermes Codex orchestration

## Goal
Finish the originally agreed active Hermes-planned/Codex-worker scope, record its safety and architecture decisions in the canonical project docs and GitHub Issues, and verify the complete local, live-integration, and CI paths without claiming untested behavior.

## Current context / assumptions

- The detailed implementation plan is `.hermes/plans/2026-10-13_023454-hermes-orchestration-migration.md`; the decision-closure plan is `.hermes/plans/2026-10-13_120347-unblock-plan-and-adrs.md`.
- The migration plan records these as implemented: Hermes plan drafting and operator review/Run; the project prompt-engineering skill and textarea; Codex worker dispatch, Queue default and optional Live steer; content-free run metadata; direct Codex controls, sync, Herdr named-session controls, Treehouse monitoring; host-level CPU/memory/disk measurements; telemetry bounds; CI and Pages workflows. The prompt skill exists at `.agents/skills/prompt-engineering/SKILL.md`; the UI composer is in `src/app/orchestration-panel.tsx`. Do not rebuild these surfaces.
- The migration plan records local baseline tests/lint/build/Python/Ansible/docs checks as passing before this final work. They were not rerun during this plan-only turn; treat them as recorded baseline evidence, not fresh verification.
- The source confirms these remaining gaps:
  - Tasks requiring privilege or access outside `$HOME` are rejected by `src/lib/orchestration-model.ts:22-28`; the original one-time approval flow through an authorized Hermes channel is not implemented. `src/app/api/orchestrator/runs/route.ts:27-34` fails closed.
  - `scripts/codex_control.py:567-630` cleans only Codex-tracked background terminals; it explicitly cannot guarantee cleanup of detached or untracked descendants. The original plan requires worker-owned child tracking, safe stop, and reconciliation.
  - `scripts/herdr_sessions.py:180-219` and `src/app/api/control/herdr/sessions/route.ts` provide named-session list/start/stop, not Herdr event subscriptions or snapshot recovery.
  - `src/lib/orchestration-store.ts:141-149` reads one run and purges terminal metadata after seven days; `src/app/api/orchestrator/runs/route.ts` has no run-list endpoint. The panel keeps a single resume hint (`src/app/orchestration-panel.tsx:187-208`).
  - The recorded checkpoint says worker-owned process metrics, service persistence checks after reboot, representative performance benchmarks, live Hermes/Codex tests, and a GitHub Actions run remain outstanding.
- Documentation is not yet a reliable status source: `docs/architecture.md:81-89` describes Herdr events and a 90-day approval audit as if they are part of the operating model; `docs/adr/0003-bounded-content-free-telemetry.md:9` says 30-day aggregate metadata while current orchestration run metadata is retained for seven days. The original user decision confirms three distinct retention classes: run/resource metadata for seven days after terminal status, aggregate telemetry for 30 days, and content-free approval decisions for 90 days. Document and implement these separately. The maintainer/operator docs also describe event subscriptions and the future approval flow. Reconcile them with actual implementation as each decision lands.
- ADRs currently end at `docs/adr/0006-codex-fleet-sync.md`. Root `GLOSSARY.md` is absent. The entire `openspec/` directory was removed at the user's direction; do not recreate it.
- `docs/agents/issue-tracker.md` says GitHub Issues are canonical. The local plans contain no verified parent-spec issue number; remote issues and workflow state were not checked in this plan-only turn.
- Git is initialized on `main` with no commits. `origin` is configured, `.agents/matt-skills` and `.gitmodules` are staged, and the rest of the project appears as untracked work. `.githabits.yaml` permits stage/commit/tag/push and `scripts/gitbbq-auto-publish.py` can publish on Stop; review that behavior before any implementation commit or publication. Preserve this existing worktree.
- Treat the original approval and worker-child requirements as outstanding, not deferred: the later proposed “accept current V1 with deferrals” option was never approved. Settled choices remain settled: active control, Codex workers, `$HOME` Home Mode, explicit review then Run, Queue default, private LAN/ZeroTier/Tailscale exposure, no public-Internet exposure, seven-day operational metadata, and no prompt/transcript/tool-output telemetry.

## Architecture / proposed approach
Use GitHub Issues as the single accepted specification and ticket system; keep the removed OpenSpec tree removed. First verify the exact Codex approval and process-ownership protocols, then turn those decisions into short ADRs and testable vertical-slice issues; implement only after the user approves the issue seams. Complete the safety-critical approval and worker-lifecycle paths before optional history/Herdr enhancements, then reconcile docs and run the full integration/CI/release gates.

## Step-by-step tasks

### 1. Re-establish the baseline and safe Git boundary

1.1. At implementation start, run:

```bash
git status --short --branch
git remote -v
git diff --cached --stat
git ls-files --others --exclude-standard
```

Expected for the inspected state: branch `main`, no commits yet, `origin` points to `https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes.git`, the Matt Pocock submodule is staged, and project files remain untracked. If the state differs, stop and preserve the current tree; do not reset, clean, or overwrite it.

1.2. Review `.githabits.yaml`, `README.md` Git workflow instructions, and `scripts/gitbbq-auto-publish.py`. Confirm exactly what the active Stop hook can stage, commit, tag, and push. Do not run a Stop-hook publication path until the full tree has been reviewed, the public-snapshot scan passes, and the user has authorized publication.

1.3. Re-run the recorded baseline before feature work. Use the full command matrix in **Tests / validation** below. Save the outputs as the new baseline; do not treat a prior plan's recorded pass as a current pass.

1.4. Because this repository has no commit baseline, review the exact staged/untracked file list with the user after the public-snapshot scan. Only after that approval, stage the approved initial source snapshot, run `git diff --cached --check`, and create the initial Conventional Commit `chore: establish reviewed project baseline`. Do not trigger the Stop hook or push during this step. If the user does not approve the snapshot, stop before creating feature commits.

### 2. Resolve only the remaining design seams

2.1. Read `.agents/matt-skills/skills/engineering/grill-with-docs/SKILL.md`, `.agents/matt-skills/skills/productivity/grilling/SKILL.md`, `.agents/matt-skills/skills/engineering/domain-modeling/SKILL.md`, `docs/architecture.md`, `CONTEXT.md`, `docs/research/interactive-control-options.md`, and `docs/adr/0001-selected-host-control.md` through `docs/adr/0006-codex-fleet-sync.md`.

2.2. Verify the actual supported Codex app-server approval request and response protocol, including event shape, response method, correlation identifiers, and behavior after reconnect. Use the official references already listed in `docs/research/interactive-control-options.md`. Record findings and a minimal fake-server/test seam there before coding. If exact Codex approval cannot be tied to a pending worker request, do not approximate it with a prompt-only or uncorrelated grant; mark the dependency blocked and bring the evidence to the user.

2.3. Prove how an explicitly launched worker child is uniquely owned and recovered after turn completion, stop, dashboard restart, and host reconnect. Start with Codex's thread-scoped `thread/backgroundTerminals/list` / `terminate` behavior in `scripts/codex_control.py`; do not use PID-name matching or broad process scans. Record supported and unsupported cases in `docs/research/interactive-control-options.md`. If a safe cross-platform mechanism cannot be demonstrated, stop before claiming the original child-termination requirement is met.

2.4. Keep the resolved contract explicit: approval is opt-in per worker, defaults off, admin identities only, one-time and bound to the exact run/task/host/thread/turn/action with expiry; timeout, replay, wrong identity, or uncertain correlation fails closed. The decision audit contains metadata only and is retained for 90 days, separate from seven-day run/resource metadata and 30-day aggregate telemetry. Worker stop acts only on saved exact worker IDs, never kills the shared app-server, and verifies the supported worker-owned child set is clear.

### 3. Record decisions and publish one canonical spec/ticket graph

3.1. After the design seams are settled, create root `GLOSSARY.md` using `.agents/skills/domain-modeling/GLOSSARY-FORMAT.md`. Define only stable domain terms (Hermes planning run, orchestration run, Codex worker/thread/turn, permission request/grant, stale observation, worker-owned child). Do not put implementation details or open decisions in the glossary.

3.2. Scan `docs/adr/` before numbering. Write short ADRs only for the hard-to-reverse choices: Hermes no-tools planner/Codex worker boundary; exact approval bridge and audit; worker-child ownership and stop guarantees. Amend existing ADRs instead of duplicating their selected-host, permission-profile, telemetry, or Herdr named-session decisions. Use the existing `Context`, `Decision`, `Consequences` format and record rejected alternatives and limits.

3.3. Reconcile `docs/architecture.md`, `docs/research/interactive-control-options.md`, `README.md`, `docs/adr/0002-dashboard-managed-profiles.md`, `docs/adr/0003-bounded-content-free-telemetry.md`, `docs/adr/0004-loopback-codex-control.md`, and these published docs: `docs-site/src/content/docs/maintainers/architecture.md`, `docs-site/src/content/docs/maintainers/protocols-telemetry.md`, `docs-site/src/content/docs/operators/controls.md`, and `docs-site/src/content/docs/operators/permissions.md`. Make every statement distinguish **implemented**, **verified live**, **planned**, and **deferred**. Keep run/resource metadata (7 days), aggregate telemetry (30 days), and content-free approval-decision audit (90 days) as distinct retention classes; do not document Herdr events or the approval bridge as shipped until they pass their tests.

3.4. Before creating issues, check GitHub auth and look for an existing parent issue:

```bash
gh auth status
gh issue list --repo averyfreeman/codex-orchestrator-dashboard-hermes --state all --limit 100 --json number,title,state,url
```

Expected: `gh auth status` identifies the intended account; the list returns JSON. Read any candidate parent with:

```bash
gh issue view "$SPEC_NUMBER" --repo averyfreeman/codex-orchestrator-dashboard-hermes --json number,title,body,labels,comments
```

If none is accepted, draft one parent spec using `.agents/matt-skills/skills/engineering/to-spec/SKILL.md`, including the existing active-control decisions and remaining acceptance criteria. Show the test seams and body to the user; create the parent only after approval with `ready-for-agent`, then read it back and verify the exact body/label. Use `.agents/matt-skills/skills/engineering/to-tickets/SKILL.md` to propose vertical-slice child issues and blocking edges; get granularity/dependency approval before publishing. Do not create an OpenSpec replacement.

### 4. Implement the exact one-time Codex approval flow (safety-critical)

Use the protocol/design output from task 2; do not start this slice before its request/response contract is proven.

4.1. Add one failing Python behavior test in `scripts/test_codex_control.py` named `test_approval_decision_is_bound_to_exact_pending_worker_request`. Run:

```bash
.venv/bin/python -m unittest scripts.test_codex_control.DashboardCodexControlTests.test_approval_decision_is_bound_to_exact_pending_worker_request -v
```

Expected RED: the assertion fails because the current bridge does not preserve and resolve the exact pending Codex approval request; it must not fail due to import/setup errors.

4.2. Implement the smallest protocol callback and correlation in `scripts/codex_control.py`. Add one test each for timeout, replay, mismatched host/worker/action, and safe denial. For each test, run its focused `unittest` command first and observe the expected RED, then implementation and GREEN.

4.3. Add a content-free approval metadata store in new `src/lib/orchestration-approval-store.ts` and tests in `src/lib/orchestration-approval-store.test.ts`; enforce one-time decisions, exact IDs, expiry, and the retention confirmed in task 2.4. Add the narrowly scoped decision route at `src/app/api/orchestrator/runs/[runId]/approvals/[approvalId]/route.ts` and a route test. Never accept the permission payload or actor identity from browser-supplied fields as authoritative; resolve both against server-side pending state and the configured Hermes-admin identity.

4.4. Add the operator approval view in `src/app/orchestration-panel.tsx` and the configured Hermes-channel adapter only after task 2 proves the supported API. Show the exact host/action/scope and expiry; require an explicit decision. Verify a denial, timeout, stale request, or channel failure leaves the task blocked and never retries or dispatches it.

Focused TypeScript command for each test-first slice:

```bash
PATH="$HOME/.local/bin:$PATH" npx vitest run src/lib/orchestration-approval-store.test.ts
```

Expected: the new assertion fails for the missing behavior before implementation and passes after it. Run the corresponding route test with its exact path using the same command. Commit each finished, green vertical slice separately with a Conventional Commit; do not push as part of this plan.

### 5. Complete worker-owned process tracking, cleanup, and metrics

5.1. In `scripts/test_codex_control.py`, add a failing test named `test_stop_reconciles_only_children_owned_by_the_selected_worker`. It must model two workers plus the shared app-server, and prove stopping one worker leaves the other worker and shared server untouched. Run:

```bash
.venv/bin/python -m unittest scripts.test_codex_control.DashboardCodexControlTests.test_stop_reconciles_only_children_owned_by_the_selected_worker -v
```

Expected RED: current cleanup is limited to Codex-tracked terminals and cannot prove all required worker-owned children are gone.

5.2. Implement the approved ownership mechanism in `scripts/codex_control.py` and the smallest necessary host helper. Persist only stable ownership IDs in `src/lib/orchestration-store.ts`; do not persist command text, environment, or terminal output. On stop/close, reconcile after the Codex turn reaches a terminal state, retry only idempotent reconciliation reads, and report `unknown` rather than falsely `cleared` when the host/API cannot confirm state.

5.3. Extend `scripts/test_codex_control.py` with tests for child survival after turn completion, stop during an active turn, reconnect after dashboard restart, failed enumeration, and isolation from another worker. Run the focused unittest for each new test before and after its implementation.

5.4. Add per-worker CPU/RSS/process counts only for the verified worker-owned IDs in `scripts/resource_metrics.py` and `scripts/test_resource_metrics.py`; preserve current host-level metrics and thresholds. Do not infer ownership from a process name or an arbitrary PID list. Extend `e2e/resource-metrics.spec.ts` to verify the UI only if the metrics are surfaced there. The focused command is:

```bash
.venv/bin/python -m unittest scripts.test_resource_metrics.ResourceMetricParsingTests -v
```

Expected: all parsing/ownership tests report `OK`; unsupported samples remain unknown, not zero. The existing `e2e/resource-metrics.spec.ts` is the browser-test location if the metrics are surfaced in the UI.

### 6. Add Herdr event streaming with snapshot recovery

6.1. Add a failing `DashboardHerdrSessionTests.test_event_gap_reconnects_from_authoritative_snapshot` in `scripts/test_herdr_sessions.py`. It should model normal events, `events_lost`, reconnection, and `session.snapshot`, and assert that pane text/terminal output is never returned. Run:

```bash
.venv/bin/python -m unittest scripts.test_herdr_sessions.DashboardHerdrSessionTests.test_event_gap_reconnects_from_authoritative_snapshot -v
```

Expected RED: the current CLI-only bridge has no event subscription or snapshot recovery path.

6.2. Implement the Herdr socket subscription/reconnect logic in `scripts/herdr_sessions.py` using the protocol documented in `docs/research/interactive-control-options.md`; keep named-session list/start/stop behavior intact. Expose a bounded same-origin stream at new `src/app/api/control/herdr/events/route.ts` and update `src/app/herdr-sessions-panel.tsx` to reconcile from a fresh snapshot after `events_lost`, disconnect, or invalid sequence. Add route tests at `src/app/api/control/herdr/events/route.test.ts` and a mocked browser test at new `e2e/herdr-events.spec.ts`.

6.3. Run the focused Python test above and:

```bash
PATH="$HOME/.local/bin:$PATH" npx vitest run src/app/api/control/herdr/events/route.test.ts
PATH="$HOME/.local/bin:$PATH" npx playwright test e2e/herdr-events.spec.ts
```

Expected GREEN: events update the selected host only; `events_lost` triggers a fresh authoritative snapshot; disconnect never implies stop; no pane content enters event payloads or logs.

### 7. Add bounded run history; avoid unnecessary archive semantics

7.1. Add a failing store test in `src/lib/orchestration-store.test.ts` named `lists_recent_runs_in_updated_order_without_expired_terminal_runs`. Run:

```bash
PATH="$HOME/.local/bin:$PATH" npx vitest run src/lib/orchestration-store.test.ts
```

Expected RED: no list function exists; the test must assert ordering, the maximum page size, seven-day terminal expiry, and continued visibility of active runs.

7.2. Implement `listOrchestrationRuns` in `src/lib/orchestration-store.ts` and extend `GET /api/orchestrator/runs` in `src/app/api/orchestrator/runs/route.ts` to return a bounded metadata-only list (maximum 100, newest update first). Add `src/app/api/orchestrator/runs/route.test.ts` and a small history/reconcile view in `src/app/orchestration-panel.tsx`. Keep the existing seven-day retention; do not add a separate archive/delete workflow unless the approved GitHub spec explicitly requires it.

7.3. Re-run the focused store and route tests. Expected GREEN: list responses contain only run/task IDs, host aliases, statuses and timestamps—never task prompts, replies, or tool output—and reconnect can select any retained run, not only the browser's last resume hint.

### 8. Verify service persistence and representative resource cost

8.1. Use the safe test hosts selected in the spec. Verify Herdr and Treehouse state after a dashboard reconnect and after a host reboot; record the exact supported platform/service combinations in `docs/architecture.md` and `docs-site/src/content/docs/operators/recovery.md`.

8.2. Benchmark one idle-monitoring interval and one representative active Codex/Herdr worker on the gateway and slowest supported host. Record probe duration, gateway/remote CPU and RSS, event volume, and token usage in `docs/research/interactive-control-options.md`. Expected: values are measured, not estimated; warnings remain advisory and never auto-kill or throttle work.

### 9. Final verification, review, and publication gate

9.1. Run the full documented suite from the repo root with the pinned runtimes:

```bash
export PATH="$HOME/.local/bin:$PATH"
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
npm audit --omit=dev
npm run docs:check
npm run docs:build
.venv/bin/python scripts/test_sync_codex_profile.py
.venv/bin/python -m unittest scripts.test_codex_control scripts.test_codex_recovery scripts.test_herdr_sessions scripts.test_codex_sync scripts.test_macos_launchagents scripts.test_ansible_inventory scripts.test_resource_metrics
.venv/bin/python -m compileall -q scripts ansible/inventory.py
.venv/bin/python scripts/check_public_snapshot.py
PATH="$PWD/.venv/bin:$PATH" .venv/bin/ansible-playbook -i ansible/inventory.py --syntax-check ansible/playbooks/sync-linux-fleet.yml
```

Expected: every command exits 0; public snapshot prints `Public snapshot scan passed.`; docs check reports 0 errors/warnings/hints. The docs build has a previously recorded `docs → 404` warning; fix it or explicitly list it as accepted before calling the release gate clean.

9.2. Run the live integration only on a designated test Hermes API Server, Codex app-server, Herdr host, and Treehouse service. Verify plan → review → explicit Run → streamed worker state → approval request/decision → stop/child cleanup → reconnect/history, with no production fleet mutations. The operator must explicitly authorize any actual worker Run.

9.3. After source is committed and published with the user's approval, verify the GitHub `Verify application, controls, and documentation` workflow for that exact commit. Expected: success. Confirm Pages deploys only from the same successful head and read back the resulting run; do not report CI/Pages as passing without that remote verification.

9.4. Review all changes against the user-approved issue and ADRs; close only verified child issues. Do not mark an approval, child-cleanup, Herdr, history, benchmark, or CI item complete unless its stated acceptance check passed.

## Tests / validation

- Every code behavior follows RED → GREEN → regression: write one focused test first; run it and observe the expected missing-behavior failure; implement the minimal change; rerun to pass; run relevant regression tests; commit the completed vertical slice. Do not batch all tests before implementation.
- For each green slice, stage only its reviewed changed paths, run `git diff --cached --check` (expected no output and exit 0), then commit with a Conventional Commit describing that slice. Never use `git add -A` on the current uncommitted baseline, and do not let an unreviewed Stop hook publish the work.
- Full local test commands are in task 9.1 and in `.github/workflows/ci.yml`; CI uses `npm ci --include=dev` because the docs workspace is build-only. Production dependency audit is `npm audit --omit=dev`; the migration checkpoint records that as clean. The full development-tree audit has recorded ESLint/Starlight findings and should be tracked separately rather than “fixed” by unreviewed major-version downgrades.
- No tests, builds, live services, issues, commits, or pushes were run in this plan-only turn.

## Risks, tradeoffs, and open questions

- The approval bridge is the highest-risk gap. Codex app-server approval and Hermes channel approval are different protocols; if no supported exact request/response correlation exists, fail closed and bring the protocol evidence back rather than use a generic `/approve` or prompt-based substitute.
- Strong child-process guarantees may not be portable across macOS/Linux and Codex versions. Do not use broad PID matching; do not claim completion when Codex-tracked terminals are the only confirmed process set.
- Run history is a usability gap, but a manual archive feature may be unnecessary under seven-day retention. Recommended minimum is a bounded list/reconcile view; add archive/delete only if the user-approved spec requires it.
- The earlier “accept current V1 with deferrals” proposal was not accepted. The original permission-approval and worker-child requirements remain open unless the user explicitly changes scope.
- The local tree has no commit baseline and contains staged plus untracked work. A first commit, tag, or push is a separate reviewed action; the configured Stop hook can publish broadly, so do not trigger it inadvertently.
- Remote GitHub issue state and Actions status remain unverified in this plan-only turn; a canonical parent issue may already exist and must be checked before creating another.
- All OpenSpec documents were removed by user instruction. Do not restore them; preserve the accepted requirements in ADRs and the canonical GitHub Issue instead.

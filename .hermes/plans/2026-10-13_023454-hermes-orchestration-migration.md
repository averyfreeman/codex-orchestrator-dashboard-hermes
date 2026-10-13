# Plan: Hermes Process Orchestration Dashboard

## Goal

Turn this workspace into a standalone Hermes-centered orchestrator that can suggest, start, stop, alter, and monitor multiple coding-harness processes in real time, using a prompt-engineering skill and dashboard textarea to deliver prompts to Codex harnesses.

## Current context / assumptions

- The active workspace is `/media/storage/build/my-repos/codex-orchestrator-dashboard-hermes`. It is already initialized on `main`, with no commits. Do not clone or retain an upstream remote, create another worktree, or create feature branches.
- The public GitHub repository `averyfreeman/codex-orchestrator-dashboard-hermes` exists and is the sole `origin`. The repository is empty; no source has been pushed.
- This is a Next.js 16 / React 19 / TypeScript dashboard with Python host-control helpers, Ansible configuration, and a docs-site workspace. `package.json` defines `npm test`, `npm run lint`, and `npm run build`; `README.md` lists additional Python, TypeScript, public-snapshot, docs, and Ansible checks.
- Current source paths include `src/lib/hosts.ts`, `src/lib/collector.ts`, `src/lib/orchestration-model.ts`, `src/app/api/overview/route.ts`, `src/app/api/orchestrator/route.ts`, `src/app/orchestration-panel.tsx`, and Codex control routes under `src/app/api/control/codex/`. The legacy status projector has been removed; `/api/orchestrator` now reports bounded Hermes API and planning-profile status. Retain the private inventory, direct Codex app-server controls, Codex fleet sync, Herdr named sessions, and Treehouse monitoring.
- The confirmed product direction is active control: suggest actions, run harnesses/processes, stop them, alter their runtime behavior, and monitor their progress/state live. V1 workers are Codex harnesses only; Hermes coordinates them. Each worker is a Codex app-server thread, reusing the existing thread/turn/interrupt bridge rather than a dedicated CLI subprocess. Workers may run on any host explicitly present in the private inventory, using local control or its configured ZeroTier/Tailscale SSH route. V1 process management covers Codex worker threads/turns and child processes started by each worker, but not unrelated host processes or services; stopping a worker must not kill the shared app-server. Configure a per-host cap for active primary Codex workers, default 4, and queue excess starts. Do not cap the number of worker-owned subprocesses. Explicitly launched background children may survive turn completion, remain tracked under their worker, and must be terminated when that worker is stopped or closed. Implementation must reliably identify/stop only the worker's children and reconcile them after failures; never use ambiguous PID matching that can kill unrelated processes. A dashboard/network disconnect is loss of observation only: keep active workers and children running, mark data stale, and reconcile/reattach by saved run/thread IDs when connectivity returns; never auto-restart or duplicate-dispatch work. Show per-host CPU, memory, disk, and worker-owned process metrics with configurable warning thresholds; warn on pressure but never auto-kill or throttle work. Defaults: CPU ≥75% sustained for 1 minute, memory ≥80%, or disk used ≥80%. Stream worker text/state/events immediately; poll host and worker-owned process metrics every 30 seconds, matching the current dashboard cadence. Ordinary file edits and non-privileged commands in Home Mode may run unattended after the operator starts a worker. The optional auto-approve override for privilege escalation and writes outside `$HOME` is per-worker, defaults OFF, is shown with the target host, and ends when the worker ends or the operator disables it. With the override OFF, such actions require explicit one-time approval; if the request cannot be safely presented or recorded, deny it. Route approval prompts through Hermes to the default configured channels (e.g. Telegram, Discord) and show them in the dashboard. Build a scoped bridge so an authorized channel reply can approve/deny only the exact pending Codex request, bound to worker, host, action, and expiry. Only identities with Hermes admin authorization in the configured channel may approve. Hermes `/approve` and `/deny` are documented for Hermes pending dangerous commands, and API Server `/v1/runs/{run_id}/approval` resolves approvals for Hermes runs; neither is documented as a bridge to Codex app-server approvals, so this Codex bridge must be implemented and verified explicitly. The dashboard persists orchestration metadata, IDs, statuses, resource metrics, and approval audit records only; prompt/reply/tool output is streamed live and not duplicated in dashboard telemetry. Hermes/Codex native thread stores provide transcript continuity. Retain active worker/run state while active; keep worker/run metadata and resource metrics for 7 days after terminal status, and approval audit decisions for 90 days before purge.
- Worker interaction and workspace controls: use a normal chat textarea. The operator's text is intent for Hermes; the project-owned prompt-engineering skill drafts a proposed plan and each Codex worker prompt. It pauses for clarification only when missing details materially change scope, safety, or acceptance; otherwise it states assumptions and drafts for operator review. Each worker prompt uses a concise contract: goal, verified context, target host/cwd, constraints and permission mode, dependencies, deliverable, acceptance checks, verification, relevant edge cases, and explicit assumptions. Do not invent repository paths or APIs; include examples and edge cases only when relevant. The plan includes task dependencies and proposed inventory hosts; Hermes proposes hosts based on task needs and capacity, and the operator can change assignments before Run. Show a run-level phase and per-task states (`drafting`, `review`, `queued`, `starting`, `running`, `approval-needed`, `completed`, `failed`, `canceled`); display the plan and prompts for review, and require an explicit Run action before dispatch. Do not auto-dispatch from the textarea in V1. On Run, dispatch all currently ready/independent tasks concurrently, within each host's configured primary-worker cap; wait for dependency prerequisites and queue excess host work. If dispatch partially fails, keep already-started workers running, reconcile identifiers, never auto-retry, and offer per-task retry. If a task fails, unrelated work continues, dependent tasks remain blocked, and retries are explicit operator actions rather than automatic. Each worker has an operator-selected, remembered routing mode: live steering or queued follow-up turns. New workers default to Queue mode; the operator can switch the worker to Live steer, with the choice remembered per worker. Queue messages FIFO as separate follow-up turns after the current turn completes; do not collapse prompts. Keep `cwd` selection as a separate interface and allow it only under `$HOME`. V1 starts and remains in Home Mode with the whole `$HOME` as its workspace-write root; no Project Mode toggle or extra roots in V1. The user deferred Project Mode (explicit `$PWD` root plus optional additional folders) to V2. Do not infer access outside `$HOME` or change global Codex configuration.
- Codex app-server behavior: the official API supports sandbox configuration on `thread/start`/`thread/resume` and per-turn `turn/start.sandboxPolicy`; changing API-scoped writable roots between turns does not require restarting app-server. `turn/steer` accepts text only and has no sandbox/cwd/model overrides; an active turn would need interruption before applying such settings on a new turn. For deferred V2 multi-root scope, official sandbox docs say writable roots can extend modification to multiple directories, but open upstream issues report that the model sees only one root (#41110) and that extra per-turn roots were not enforced on some macOS versions (#35437). Treat multi-root behavior as unverified until tested on each supported host OS/Codex version; do not promise cross-root access before that verification. Global Codex configuration reload behavior is undocumented and global config remains untouched. Sources: https://learn.chatgpt.com/docs/app-server, https://learn.chatgpt.com/docs/sandboxing, https://github.com/openai/codex/issues/41110, https://github.com/openai/codex/issues/35437
- Hermes runtime: use a dedicated Hermes API Server profile on the dashboard host, bound to loopback. The dashboard backend calls it with a server-side bearer key and least-privilege tools; the existing native Codex app-server bridge controls worker threads on target hosts. Never send the Hermes key to browser code or expose the API Server directly to the LAN. Official API Server features include durable `POST /v1/runs` with idempotency keys, status polling, SSE events, and stop; `GET /v1/capabilities` advertises support. The API requires a bearer key even on loopback and exposes the configured toolset (including terminal/file tools), so restrict this profile and use structured tools that enforce host/resource scope rather than prompt-only restrictions. Its `run_approval` endpoint applies to Hermes runs, not Codex app-server approval events. Hermes messaging documents `/approve` and `/deny` for Hermes dangerous-command prompts, but a Codex approval bridge is not documented. Sources: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server, https://hermes-agent.nousresearch.com/docs/user-guide/messaging, `.hermes` skill `references/api-server-integration.md`
- Other confirmed decisions: unauthenticated reads and run/stop/alter controls are accepted from the default LAN plus ZeroTier/Tailscale overlays; all repo checks must block CI acceptance; use the documented triage-label set (`wontfix` already exists; add the four missing labels); and keep one shared domain context for dashboard and docs site. Do not interpret LAN/overlay approval as public-Internet exposure.
- The local npm currently resolves to Hermes’ bundled toolchain unless PATH is corrected. The intended system commands are `$HOME/.local/bin/npm` (symlink target `$HOME/.local/pkgs/npmjs.com/v12.2.0/bin/npm`, npm `12.2.0`) and `$HOME/.local/bin/node` (Node `v26.10.0`). Prefix development commands with `PATH="$HOME/.local/bin:$PATH"` and verify the resolved binaries.
- `uv` is available at `$HOME/.local/bin/uv`. Before any Python command, add `/.venv/` to `.gitignore`, create `.venv` with `uv venv --managed-python --python 3.11 .venv`, activate it, and use its Python for all project Python commands.
- Matt Pocock’s upstream skill repo is pinned as submodule `.agents/matt-skills` at `49dd158d1076134a641b33efb035946536778336`. Keep the existing `.agents/skills/` intact; use the upstream `skills/engineering/` and `skills/productivity/grilling/` files for the selected workflows.
- The user explicitly directed removal of all OpenSpec documents. The entire `openspec/` directory, including every active proposal and its metadata, was removed before a GitHub spec issue was verified. GitHub Issues remain canonical per `docs/agents/issue-tracker.md`; do not recreate OpenSpec documents or treat their deletion as acceptance of their requirements.
- A confirmed privacy risk remains important even for an active orchestrator: successful reports include `host.sshRoutes` targets (`src/lib/collector.ts:86-105`), fallback reports expose raw truncated probe/SSH errors (`src/lib/collector.ts:107-110`), and `publicHost` removes `codexHome` but not SSH routes (`src/lib/hosts.ts:86-89`). The overview GET returns reports without an origin/auth guard (`src/app/api/overview/route.ts:5-12`); the logs GET also returns recent private events without one (`src/app/api/logs/route.ts:4-10`). Review and ticket the privacy boundary explicitly; it is not a reason to make the orchestrator read-only.
- The legacy configured-fleet screenshots were removed from `docs-site/public/screenshots/`; the guide now points only to the synthetic, disabled-control preview. Keep the public-snapshot check before any source publication.
- The user approved implementation and added two settled requirements: eliminate all first-party references to the unrelated legacy integration, and implement a prompt-engineering skill plus an Orchestrator textarea that accepts operator instructions and routes Codex-ready prompts. Local GitHub/submodule/runtime/dependency bootstrap and baseline checks are complete; issue-tracker setup and application implementation are not. Nothing has been committed or pushed.

## Execution status

- [x] Initialized this workspace on `main`; created the empty public repository `averyfreeman/codex-orchestrator-dashboard-hermes`, set only `origin`, and verified `isPrivate: false`. No source has been pushed.
- [x] Added `.agents/matt-skills` as a submodule pinned at `49dd158d1076134a641b33efb035946536778336`; verified all planned upstream skill paths exist.
- [x] Added `/.venv/` to `.gitignore`; created and activated `.venv` with managed CPython 3.11.17. Verified system npm 12.2.0 and Node v26.10.0 resolve from `$HOME/.local/bin`.
- [x] `npm ci` completed. It reported 17 audit findings (2 low, 10 moderate, 5 high) and skipped install scripts for `esbuild` and `unrs-resolver`; baseline tests/builds still passed.
- [x] Baseline checks passed: Vitest (6 files, 18 tests), ESLint, TypeScript, Next production build, all four Python test groups, Python compilation, public-snapshot scan, and Ansible syntax check. Docs validation reported 0 errors/warnings/hints; docs build completed with an existing missing `docs → 404` content warning.
- [x] Completed the read-only whole-tree Standards review at the user's selected current-tree baseline. Spec review is unavailable because no accepted spec exists. Four Standards findings are recorded below; no code, tests, hosts, commits, or pushes were changed by the review.
- [x] Completed upstream skill setup after user confirmation: updated `docs/agents/issue-tracker.md` for the new GitHub repo, updated `.githabits.yaml` remote name/URL, retained the aligned `AGENTS.md` skills block and single-context/triage docs, and created the four missing GitHub labels. Read-back verified all five canonical labels and descriptions. No commit or push.
- [ ] Complete the one-at-a-time architecture grill; then draft ADRs and the GitHub specification/ticket graph for user review.

## Architecture / proposed approach

Keep the Next.js app as the operator UI and control plane, and use Hermes as the coordinator for actual harness/process lifecycle actions rather than a passive status source. The Orchestrator textarea accepts operator intent; Hermes uses a project-owned prompt-engineering skill to refine it into Codex-ready prompts and deliver them through authorized harness adapters. Current preferred integration candidate: Hermes API Server Runs API (`POST /v1/runs`, `GET /v1/runs/{run_id}`, SSE at `/events`, and `POST /stop`) behind server-side Next routes, with the bearer key kept server-side. Treat stop as asynchronous (`stopping` until executor work exits), use an idempotency key for safe creation retries, and verify required features through `/v1/capabilities`. Official references: [API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) and [Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills). A project-local skill belongs under `.agents/skills/`; Hermes requires the repo to be trusted, and non-interactive API surfaces inherit that trust decision. Treat this as a recommendation, not a settled decision: use the grill to settle runtime, harness coverage, prompt review/dispatch, persistence, authorization, and safety boundaries before implementation.

## Step-by-step tasks

### 0.1 Initialize a new local repository

Run these commands from the active workspace root. Do not clone upstream, create a worktree, set an upstream remote, or create feature branches.

```bash
cd /media/storage/build/my-repos/codex-orchestrator-dashboard-hermes
git init
git status --short --branch
```

Expected: Git reports an initialized repository; status shows the initial/default branch and the existing project files as untracked.

### 0.2 Create the empty public GitHub repo and attach `origin`

Check that the requested name is available:

```bash
gh repo view averyfreeman/codex-orchestrator-dashboard-hermes --json nameWithOwner,url,isPrivate
```

Expected for a new target: GitHub explicitly reports “not found.” If it already exists, stop and inspect it; do not replace or reuse it silently. Stop on authentication or network errors. Then create the public repo and attach only `origin`:

```bash
gh repo create codex-orchestrator-dashboard-hermes --public
git remote add origin https://github.com/averyfreeman/codex-orchestrator-dashboard-hermes.git
git remote -v
gh repo view averyfreeman/codex-orchestrator-dashboard-hermes --json nameWithOwner,url,isPrivate
```

Expected: `git remote -v` lists only `origin` at the requested URL, and the final JSON identifies `averyfreeman/codex-orchestrator-dashboard-hermes` with `isPrivate: false`. Do not pass `--push`; the public repo is created empty and source publication waits for the public-snapshot checks and the user’s explicit approval.

Before using any Stop hook or automation on the default branch, inspect `.githabits.yaml` and the project hook documentation. The current config permits staging/committing/tagging/pushing on `main`; disable or avoid any automatic publication path until the user authorizes a push. Work directly on the repository’s current branch as requested; do not create a feature branch.

### 1. Add and pin the upstream Matt Pocock skills submodule

From the new repository root, add the public skills repository at a separate path:

```bash
git submodule add https://github.com/mattpocock/skills.git .agents/matt-skills
git submodule status
test -f .agents/matt-skills/skills/engineering/setup-matt-pocock-skills/SKILL.md
test -f .agents/matt-skills/skills/engineering/code-review/SKILL.md
test -f .agents/matt-skills/skills/engineering/grill-with-docs/SKILL.md
test -f .agents/matt-skills/skills/engineering/domain-modeling/SKILL.md
test -f .agents/matt-skills/skills/engineering/to-spec/SKILL.md
test -f .agents/matt-skills/skills/engineering/to-tickets/SKILL.md
test -f .agents/matt-skills/skills/engineering/implement-spec/SKILL.md
test -f .agents/matt-skills/skills/engineering/tdd/SKILL.md
test -f .agents/matt-skills/skills/productivity/grilling/SKILL.md
```

Expected: `git submodule status` prints a pinned commit and `.gitmodules` names `https://github.com/mattpocock/skills.git`; all `test -f` checks exit 0. Keep `.agents/skills/` intact, but use the upstream submodule paths above for the setup, review, grill, spec, tickets, implementation, and TDD workflows.

### 2. Pin the development runtimes before running project checks

**2.1 — Use system Node/npm.** In every shell used for development, put the system path first and verify it before running npm commands:

```bash
export PATH="$HOME/.local/bin:$PATH"
printf 'npm: %s (%s)\n' "$(command -v npm)" "$(npm --version)"
printf 'npm symlink: %s\n' "$(readlink "$HOME/.local/bin/npm")"
printf 'node: %s (%s)\n' "$(command -v node)" "$(node --version)"
test "$(command -v npm)" = "$HOME/.local/bin/npm"
test "$(readlink "$HOME/.local/bin/npm")" = "$HOME/.local/pkgs/npmjs.com/v12.2.0/bin/npm"
test "$(npm --version)" = "12.2.0"
test "$(command -v node)" = "$HOME/.local/bin/node"
test "$(node --version)" = "v26.10.0"
```

Expected visible lines identify npm `12.2.0` at `$HOME/.local/bin/npm` and Node `v26.10.0` at `$HOME/.local/bin/node`; all assertions exit 0. Stop if either resolves to `$HOME/.hermes/tools/...`.

**2.2 — Create the Python 3.11 environment before any Python command.** First add this exact ignore entry to `.gitignore` if it is absent:

```gitignore
# Python virtual environments
/.venv/
```

Then, before running `python`, `python3`, or any project Python script, run:

```bash
uv venv --managed-python --python 3.11 .venv
source .venv/bin/activate
python --version
command -v python
```

Expected: the version prints `Python 3.11.x` and `command -v python` resolves to this repository’s `.venv/bin/python`. If the managed interpreter cannot be installed, stop and report the `uv` failure; do not fall back to Hermes’ Python or system Python.

**2.3 — Install JavaScript dependencies from the lockfile.** Keep the system Node/npm path first and `.venv` activated in this shell:

```bash
npm ci
```

Expected: exit 0 and dependencies install from `package-lock.json`; do not allow npm to use Hermes’ bundled Node/npm. Keeping `.venv` activated also ensures any install script that invokes Python uses the managed 3.11 environment.

### 3.1 Trace the current architecture without contacting the live fleet

Read `AGENTS.md`, `README.md`, `IDEA.md`, `CONTEXT.md`, `docs/architecture.md`, `docs/research/interactive-control-options.md`, every ADR in `docs/adr/`, `.githabits.yaml`, current API/UI routes, existing OpenSpec proposals, and `.github/workflows/pages.yml`. Trace the current observe and control paths through `src/lib/collector.ts`, `src/lib/hosts.ts`, `src/lib/orchestrator.ts`, `src/app/api/overview/route.ts`, `src/app/api/orchestrator/route.ts`, `src/app/page.tsx`, `src/app/control-panel.tsx`, and `src/app/api/control/codex/`. Record the legacy view’s dependencies and all inherited surfaces that may be retained; do not contact a live fleet. Expected: a short file-and-data-flow map and a complete first-party removal checklist, with no code changes.

### 3.2 Run the existing Vitest suite

With the system PATH set, run:

```bash
npm test
```

Expected: exit 0 and Vitest reports no failed tests. Record existing failures separately from later changes.

### 3.3 Run lint and TypeScript checks

With the system PATH set, run:

```bash
npm run lint
npx tsc --noEmit
```

Expected: both exit 0 with no ESLint or TypeScript diagnostics. Record existing failures separately.

### 3.4 Run the production build

With the system PATH set, run:

```bash
npm run build
```

Expected: exit 0 and Next completes a production build. Record existing failures separately.

### 3.5 Run the existing Python tests under `.venv`

After activating `.venv`, run all project Python commands with that environment’s `python`:

```bash
python scripts/test_sync_codex_profile.py
python -m unittest scripts/test_codex_control.py scripts/test_codex_recovery.py scripts/test_herdr_sessions.py
python -m unittest scripts/test_codex_sync.py
python -m unittest scripts/test_macos_launchagents.py
```

Expected: each test command exits 0 and reports `OK`/success. Record existing failures separately.

### 3.6 Run Python syntax and public-snapshot checks under `.venv`

With `.venv` activated, run:

```bash
python -m py_compile scripts/probe.py scripts/codex_control.py scripts/codex_recovery.py scripts/codex_sync.py scripts/herdr_sessions.py scripts/sync_codex_profile.py ansible/inventory.py
python scripts/check_public_snapshot.py
```

Expected: Python compilation exits 0 and the snapshot scan prints `Public snapshot scan passed.`. Any private-data finding blocks source publication. Manually inspect screenshot assets before any push.

### 3.7 Run the Ansible syntax check using the managed Python environment

Use an Ansible executable installed into the activated venv; if it is absent, install it into this venv with `uv pip install ansible`, then run:

```bash
.venv/bin/ansible-playbook -i ansible/inventory.py --syntax-check ansible/playbooks/sync-linux-fleet.yml
```

Expected: Ansible reports a successful syntax check. If `.venv/bin/ansible-playbook` is still absent, report the prerequisite as blocked rather than invoking a system Python installation.

### 4. Configure the upstream skills for this newly initialized repo

Read and follow `.agents/matt-skills/skills/engineering/setup-matt-pocock-skills/SKILL.md` and its linked templates. Explore the new remote, `AGENTS.md`, `CLAUDE.md` if present, `docs/agents/`, `docs/adr/`, and root glossary files before editing. Use GitHub Issues on `averyfreeman/codex-orchestrator-dashboard-hermes` as the requested tracker; retain the existing triage label vocabulary unless the user changes it. Use the existing single-context domain layout unless the setup skill’s required confirmation changes that choice.

Update only the necessary configuration files: `docs/agents/issue-tracker.md` must point to the new repo; update the existing `## Agent skills` block in `AGENTS.md` or `CLAUDE.md` in place if needed; keep `docs/agents/domain.md` and `docs/agents/triage-labels.md` consistent with the confirmed choices; update `.githabits.yaml`’s remote name/URL to the new repo and ensure it cannot push automatically. The setup skill requires presenting the draft to the user before writing. Validate:

```bash
git diff --check
git status --short
git remote -v
```

Expected: no whitespace errors, only approved setup/submodule files are changed, and `origin` is the new repo. Commit the approved bootstrap/setup slice after validation; do not push it.

### 5. Review the existing source before architecture grilling

Read `.agents/matt-skills/skills/engineering/code-review/SKILL.md` and follow its two-axis Standards/Spec process. The upstream skill normally reviews a non-empty diff from a user-selected fixed point; this new repository has no commits. The user selected a whole-tree source review of the current tree as-is. Report Standards findings and “no spec available” for the Spec axis; do not invent upstream history or create an artificial commit just to manufacture a diff.

The review explicitly assessed privacy, screenshots, telemetry, and CI. Keep active process control in scope; do not treat write/run/stop/alter capability itself as a defect.

**Review outcome:** Standards: 4 findings; Spec: unavailable, 0 findings; heuristic smells: none identified. The screenshot, overview-leakage, telemetry-schema, and retention findings are addressed below. Application/control/docs verification now runs in `.github/workflows/ci.yml`; the Pages workflow builds the same tested commit only after that workflow succeeds. The reviewer did not run tests or access private inventories/hosts.

1. **Resolved — screenshots disclosed operational data.** Manual inspection found hostnames, LAN/overlay addresses, a user-specific worktree path, and process IDs/commands. Removed the configured-fleet screenshot files and all guide links; only the synthetic static preview remains. Recheck the file list and generated docs output before publication.
2. **Resolved — host route and raw error leakage.** Browser reports now omit SSH route targets and `CODEX_HOME`, clear connection targets, and replace raw probe/SSH errors with a generic status. The existing private host labels, IPs, process, and worktree views remain available on the approved private interfaces.
3. **Resolved — ingested telemetry is metadata-only.** `/api/logs` now accepts only the documented event envelope with bounded identifiers and flat finite numeric metrics; unknown top-level fields, nested stats, free-text metric values, and invalid timestamps are rejected.
4. **Resolved — telemetry retention and file bounds.** The JSONL store prunes invalid/expired records on reads and writes, retains at most seven days and 1,000 events / 1 MB, and reads only a bounded tail of oversized existing files.

### 6. Record pre-grill decisions, then run the architecture grill

The pre-grill side questions are answered: unauthenticated LAN and ZeroTier/Tailscale access includes run/stop/alter controls; all repo verification checks should block app/control acceptance; configure the documented triage labels; keep one shared domain context. Do not ask again whether the orchestrator should be read-only: the user has explicitly decided it must control processes. The dashboard now uses private-interface proxy listeners for LAN, ZeroTier, and Tailscale without broadening the intended scope beyond those private paths.

Read and follow these upstream files: `.agents/matt-skills/skills/engineering/grill-with-docs/SKILL.md`, `.agents/matt-skills/skills/productivity/grilling/SKILL.md`, and `.agents/matt-skills/skills/engineering/domain-modeling/SKILL.md`. Ask **one question at a time** using a single-select `clarify` selector, put the recommended choice first, wait for the user’s answer, then recompute the design-tree frontier. Do not combine independent grill questions into one selector and do not ask a downstream question before its prerequisites are settled.

Resolve these decisions from concrete scenarios rather than assumptions:

- Choose durable run/worker identifiers and idempotency keys across dispatch retries; after reconnect, reattach to saved identifiers before allowing any operator retry.


- Choose and verify the child-process ownership/tracking mechanism and reconciliation after host/dashboard restart; stopping/closing one worker must terminate only its worker-owned descendants.
- Which inherited surfaces—host inventory, Herdr, Treehouse, Codex sync, and direct Codex controls—belong in this standalone product. The unrelated legacy integration is out of scope and must be removed, not reconsidered as an optional feature.
- Verify the dedicated Hermes profile loads `.agents/skills/prompt-engineering/SKILL.md` from the trusted project context for non-interactive API runs. If project-local skill discovery is insufficient, package it in the dedicated profile only; do not modify the user's default Hermes profile.


- Artifact handling and operator attribution. Prompts, replies, and tool output must remain out of dashboard telemetry.
- V1 acceptance criteria and explicit out-of-scope items.

As decisions crystallize, update root `GLOSSARY.md` using the upstream domain-modeling format and write ADRs only for hard-to-reverse decisions with real alternatives. The current highest ADR is `0006`; scan `docs/adr/` before assigning `0007` and later numbers. Candidate topics include Hermes runtime, harness adapter contract, process lifecycle/state, and safety/approval policy. Keep each ADR short and decision-focused; do not write implementation details into the glossary.

### 7. Publish one canonical project specification in GitHub Issues

After the grill reaches shared understanding, use `.agents/matt-skills/skills/engineering/to-spec/SKILL.md`. Agree the highest-level test seams with the user before publishing. Synthesize the agreed design—do not restart the interview—and create one parent issue in `averyfreeman/codex-orchestrator-dashboard-hermes` with the upstream skill’s sections: Problem Statement, Solution, extensive numbered User Stories, Implementation Decisions, Testing Decisions, Out of Scope, and Further Notes. The specification must explicitly include active start/stop/alter/monitor capabilities, the prompt-engineering skill, and the Orchestrator textarea-to-Codex prompt flow. Do not create an OpenSpec change for the same migration.

Read the new issue back:

```bash
gh issue view <SPEC_NUMBER> --json number,title,body,labels,comments
```

Expected: the body matches the accepted design and includes the `ready-for-agent` label. Do not proceed to tickets if the issue is missing, malformed, or contradicts an accepted ADR.

### 8. Keep all OpenSpec documents removed

The user explicitly directed removal of all OpenSpec documents. The entire `openspec/` directory was removed before a GitHub spec issue was verified. Do not recreate OpenSpec documents or interpret their removal as approval of their contents. Before proceeding with a canonical specification, verify the user-approved GitHub issue by reading it back as described in step 7.

### 9. Create the GitHub ticket graph

Read and follow `.agents/matt-skills/skills/engineering/to-tickets/SKILL.md`. Convert the accepted spec into small demoable end-to-end slices; include active control, live monitoring, status reconciliation, the prompt-engineering skill, the dashboard textarea, Codex prompt delivery, privacy/CI prerequisites if approved, and only the harness adapters chosen in the grill. Include a separate cleanup ticket only if the all-reference sweep could not be completed as part of the project foundation. Show the proposed title, “what it delivers,” and blockers for every ticket; get user approval of granularity and dependencies before creating issues. Publish in dependency order with `ready-for-agent` and native blocking links when supported. Do not create OpenSpec task files for the same work and do not close or modify the parent spec issue.

Verify every issue by reading it back with `gh issue view <ISSUE_NUMBER> --json number,title,body,labels,comments`; confirm its acceptance criteria, parent reference, and dependency edges before starting implementation.

### 10. Implement the approved ticket graph on the existing default branch

Read and follow `.agents/matt-skills/skills/engineering/implement-spec/SKILL.md` and `.agents/matt-skills/skills/engineering/tdd/SKILL.md`. Respect the user’s explicit branchless preference: use the single initialized repository/default branch, process one ready ticket at a time, and do not create integration/feature branches or worktrees. Preserve the skill’s task-graph/frontier discipline and TDD; do not run parallel writers in the same working tree.

The first end-to-end slice must exercise the operator textarea through Hermes prompt engineering to a Codex harness, with observable status and honest error/cancellation behavior. Add the project-owned skill under `.agents/skills/prompt-engineering/SKILL.md`; adapt the upstream MIT example and create only supporting references required by the agreed scenarios. Create a focused prompt-composition module and tests at `src/lib/prompt-engineering.ts` and `src/lib/prompt-engineering.test.ts` only if the design needs deterministic code beyond the skill instructions. Implement the Orchestrator UI in `src/app/orchestrator-panel.tsx` and add its navigation/view integration in `src/app/page.tsx`; settle the server route and Hermes API contract in the spec before implementing them. Remove the current status-only implementation from `src/lib/orchestrator.ts`, `src/lib/orchestrator.test.ts`, and `src/app/api/orchestrator/route.ts` rather than layering the new agent over it.

For each approved code ticket:

1. Use the exact test file and public seam named in that ticket. Write one behavior test first. Run its focused command (for a Vitest file, `PATH="$HOME/.local/bin:$PATH" npm test -- <EXACT_TEST_FILE>`; replace `<EXACT_TEST_FILE>` with the path from the approved ticket before execution). Expected RED: the new assertion fails for the missing behavior, not because of a typo or setup failure.
2. Add the smallest implementation in the exact production paths listed in that ticket. Rerun the same focused command. Expected GREEN: the targeted test passes.
3. Run relevant regressions. For TypeScript tickets run `PATH="$HOME/.local/bin:$PATH" npm test`, `PATH="$HOME/.local/bin:$PATH" npm run lint`, and `PATH="$HOME/.local/bin:$PATH" npx tsc --noEmit`; run `PATH="$HOME/.local/bin:$PATH" npm run build` before declaring the integration release-ready. For Python tickets, confirm `.venv` is active and run the exact `python -m unittest ...` target in that ticket.
4. Refactor only after tests pass. Rerun the focused and relevant regression commands, then commit the finished ticket on the current branch with a conventional commit. Do not push unless the user explicitly authorizes publication.
5. Continue with the next unblocked ticket. At completion, run the upstream code-review skill against a user-approved non-empty diff if one exists; otherwise do not invent a fixed point. Rerun the full documented verification matrix and report any gate that was not run as not run, not passed.

## Tests / validation

- **Bootstrap:** verified `main` has no commits, `origin` is the public `averyfreeman/codex-orchestrator-dashboard-hermes` repo, and `.agents/matt-skills` is pinned to the recorded upstream commit. Do not push source without the public-snapshot scan and explicit approval.
- **Legacy removal:** search all first-party source, docs, fixtures, examples, screenshots, configs, tests, and generated site output for the retired integration; expected zero matches after cleanup. Exclude third-party dependencies and the pinned skills submodule from that first-party check.
- **Prompt path:** verify an operator’s textarea submission reaches the Orchestrator, the skill yields a Codex-ready prompt under the agreed review/dispatch policy, a target Codex harness receives it, and progress/errors return to the UI without logging prompt contents by default.
- **New repo:** verify `git remote -v` contains only the requested `origin`; verify GitHub reports the new repo public. Do not push code until the snapshot scan passes and the user explicitly authorizes it.
- **Runtime selection:** npm `12.2.0` and Node `v26.10.0` were verified from `$HOME/.local/bin`; Python 3.11.17 was verified in `.venv/bin/python` before Python commands.
- **Baseline:** npm tests/lint/TypeScript/build, Python tests/compile/public-snapshot scan, Ansible syntax check, and docs check/build completed successfully before application changes. Preserve the existing docs build warning about the missing `docs → 404` content page.
- **Per-code-ticket TDD:** failing behavior test → observe expected RED → minimal code → observe GREEN → regression checks → refactor → commit. Every ticket must name exact test and production paths before work starts.
- **Public gate:** `.venv`-managed `python scripts/check_public_snapshot.py` must print `Public snapshot scan passed.`; manually inspect images and source diff before any push.
- **External state:** after repo or GitHub issue creation, read the exact target back with `gh` and verify visibility, title/body, labels, and blocker links before reporting success.

## Risks, tradeoffs, and open questions

- **New repo with no upstream history:** this simplifies ownership and avoids upstream branch complexity, but there is no non-empty diff or accepted spec. The user selected a whole-tree Standards review; report Spec unavailable and do not fabricate ancestry.
- **Public source publication:** the destination is public. Configured-fleet screenshots were removed; pushing contents remains gated by the public-snapshot scan and explicit approval.
- **Active control requires deliberate boundaries:** the orchestrator must be able to act, but which hosts, repos, processes, commands, environment changes, and approvals are permitted must be settled in the grill. Do not quietly narrow the product to a read-only observer or broadly grant unscoped shell access.
- **Process lifecycle truth:** a stop request may be asynchronous and a worker may continue after dashboard connectivity is lost. Model actual worker state, not the state of the browser stream.
- **Privacy risk:** the Standards findings for overview route/error leakage and unbounded telemetry have been addressed with report sanitization, a numeric-only ingestion schema, and seven-day/size-bounded retention. Continue treating private inventory and process/worktree metadata as sensitive; do not publish configured-fleet captures or raw operational logs.
- **Public screenshot risk:** configured-fleet screenshot assets were removed after manual inspection; keep the synthetic preview only and rerun the asset/public-snapshot checks before any publication.
- **Standalone scope:** the prior status projector and configured-fleet screenshot assets have been removed, and first-party docs/fixtures were updated. Rerun a full source, docs, and generated-output search after builds to verify no retired terms return.
- **Prompt quality and dispatch:** the example skill is Claude-oriented and its generic prompt techniques do not define safe Codex dispatch. Adapt the reusable techniques, settle whether prompts require operator review, and test prompts against realistic tasks before allowing unattended delivery.
- **Runtime skill visibility:** Hermes documents `.agents/skills/` as a project-local skill path, but loads it only for a trusted repository; non-interactive API surfaces inherit that trust decision. Verify the API server's working directory/trust state and skill visibility. Do not copy the skill into the user’s default Hermes profile or rely on prompt text alone for host/process authorization.
- **Upstream skill mismatch:** Matt Pocock’s `implement-spec` skill prescribes branches/worktrees; the user explicitly prefers one default branch. This plan uses its ticket/frontier/TDD discipline while intentionally skipping its branch/worktree model. If the user later requires exact upstream workflow, resolve that conflict before implementation.
- **Python pin:** `uv` must supply managed Python 3.11 before any Python command. A failed managed install blocks Python verification; never silently fall back to another interpreter.
- **Canonical spec source:** GitHub Issues are the planned single source for the Hermes specification and tickets. Remove the Hermes OpenSpec draft only after the GitHub issue has been reviewed and verified; do not leave two active specs for the same migration.
- **Unsettled architecture:** harness list, process alteration semantics, Hermes runtime surface, persistence, and safety policy remain open for the one-at-a-time grill. Code paths beyond the currently observed files must not be invented before those choices and the ticket graph are accepted.

## Current implementation checkpoint

Completed: private-interface dashboard networking; Hermes planning plus Codex app-server task orchestration; Queue and optional Live-steer UI; selected-host controls, recovery, Herdr sessions, Codex fleet sync, and Treehouse monitoring; metadata-only orchestration persistence and best-effort run stop; screenshot removal and browser-report redaction; flat numeric telemetry ingestion with seven-day/1,000-event/1 MB bounds; cross-platform host CPU, memory, and home-volume metrics with configurable warning thresholds; CI gates for frontend, Python, Ansible, docs, public-snapshot, and Chromium Playwright checks; and a production-dependency audit gate. Docs-only Astro, Starlight, and Mermaid packages are dev dependencies; Mermaid is pinned to 12.2.0. Browser tests cover resource warnings, review-before-dispatch, fail-closed approval-required plans, live-steer association, and confirmed run-stop association.

Still open: approval-required and out-of-home tasks remain fail-closed; no archive/list API exists, and New plan detaches the current resume hint while run metadata remains until seven-day expiry; Herdr event-driven state with subscription-loss and snapshot recovery remains unimplemented; live Hermes planning/Codex dispatch and steer have not been exercised against running services; detached or untracked worker descendants cannot be guaranteed to stop and are documented as best-effort. The GitHub workflow has not been run on GitHub. Full npm audit reports 15 development-tree findings (5 high in the ESLint toolchain and 10 moderate in documentation build dependencies); `npm audit --omit=dev` is clean. The suggested blanket fixes downgrade ESLint and Starlight across semver-major versions, so none were forced. Local browser, app, Python, Ansible, docs, production-dependency audit, and public-snapshot gates pass. No commit or push has been made.

# Codex fleet deployment — 2026-10-14

## Result

The approved custom-plugin subsets and main, focused, and sysadmin configurations are installed on Maccauley, Flautist, dc2, and moltbuntu. All four CLI installations and running daemons report 0.162.1. Fresh invocations initialized every enabled local stdio MCP in the approved configurations. Standalone OpenAI Developer Docs and Cloudflare HTTP initialization returned 403 from this environment and remains unverified.

The work is on branch `repair/codex-fleet-sync`. No repository publication or remote account mutation was performed. The older OpenClaw dashboard was retained as a reference; OCI was excluded.

## Source findings and corrections

The private inventory incorrectly designated Maccauley as the gateway and contained stale LAN addresses. Flautist is now local, Maccauley is remote, and moltbuntu has an inventory entry. LAN SSH routes use existing verified key identities, with strict checking and configured overlay fallbacks. Hostname, OS, and architecture were checked on every approved host.

Maccauley was upgraded from CLI 0.161.0 to 0.162.1 with the pinned official installer. The other hosts already had 0.162.1. Main preferences remain `gpt-6.1-sol`, medium reasoning, maximum plan reasoning, workspace-write, live search, and network access. Focused retains its own model/reasoning and capability enablement. Shared provisioning now uses the corrected main model defaults.

Removed sequential-thinking's ignored per-tool enabled field while retaining its tool approval control and server enablement. Moved LinkedIn's cautious pacing into the package's MCP environment. Corrected worker/manager declarations and added their role config layers using the [official configuration schema](https://learn.chatgpt.com/docs/config-file/config-reference). Both preserve the Luna model and maximum model reasoning; manager plan reasoning remains medium. Resolved Sky to its installed absolute executable. Kept native application paths and notifications local. Removed Helios from the source baseline and excluded the unconfigured RAG package and deprecated preview from fleet sync. The existing preview on Maccauley was retained locally.

Additional capability checks found broken package assumptions: LinkedIn's launcher traversed outside its installed package, Hugo required both a site root and generated public content, and Astra needed an explicit usable project working directory and MCP registration. These now resolve to installed packages and captured local inputs. Astra defaults to the fleet build workspace; project-specific calls should supply the intended project root.

## Installed matrix

| Host | Active release plugins | Ubuntu execution | Activation |
| --- | --- | --- | --- |
| Maccauley | All six releases; existing local preview retained | Verified SSH connection to Flautist | Existing daemon retained; idle state unknown |
| Flautist | All six releases | Local | Managed idle restart initially timed out; down-only recovery succeeded and the unit is active |
| dc2 | git-bbq, spit-roast, long-running-tasks-plugin | Local | Existing daemon retained because an active turn was reported |
| moltbuntu | All six releases; legacy Git BBQ selectors inactive | Local | Existing daemon retained; dashboard-managed service is not enabled |

The six releases are git-bbq 0.4.0, hugo-railway 0.1.0 plus its captured Codex packaging revision, linkedin-chatgpt-adjunct 0.2.1, spit-roast 0.1.0, astra-watch 0.1.0, and long-running-tasks-plugin 0.2.0. Linux releases are installed through the private `fleet-release` local marketplace. Maccauley retains its established release marketplaces.

Filesystem 1.7.10 and sequential-thinking 0.1.0 were installed through npm-managed inputs. daisyUI 0.2.1 uses its local release wheel where approved; Ubuntu MCP 0.2.3 uses its captured source package through uv. No Mac virtual environment or node_modules tree was transferred. Linux Git BBQ and Hugo were built with Go 1.27.1; Astra used `cargo build --release --locked` with Rust 1.98.1. The common Linux artifacts were built on Flautist and verified on the other x86_64 targets. Package content and executable metadata matched the manifest on all Linux targets.

The long-running-task MCP has one registration from the approved plugin. Stale standalone launchers were removed from effective configs. dc2 has no daisyUI entry in its configurations. Moltbuntu's incomplete standalone cua_repl entry was removed without a dedicated backup; verified native integrations remain host-owned.

## Profiles and privileged execution

Use `codex`, `codex --profile focused`, and `codex --profile sysadmin`. Profile files inherit main settings; focused explicitly disables the host's Ubuntu server. Main does not enable sudo. Sysadmin enables sudo with repeated executable-specific `--sudo-command` paths resolved on the execution host, including the available requested file, package, service, Samba, TDB, and LDB tools. No executable directory was allowlisted. Missing Samba/LDB tools are recorded as host differences; no unrelated Samba service was installed and sudoers was unchanged.

All four host paths passed the Ubuntu policy checks: main rejected sudo, focused disabled Ubuntu, and sysadmin rejected an unlisted executable while permitting configured paths. Privileged listing, touch, and removal tests used disposable fixtures only. Maccauley's system-information response identified Flautist, and its privileged fixture checks also executed there.

## Dashboard implementation and evidence

See [ADR 0007](adr/0007-platform-aware-fleet-deployment.md). The sync helper now classifies approved MCP definitions and role layers, preserves executable metadata, fingerprints native files even when JSON transfer is blocked, and checks expected host identity. The planner consumes the private host matrix, excludes preview and target-ineligible capabilities, preserves host-native managed plugins, and reports verified platform adoption. File-backed package/dependency staging uses bounded checksum-verified archives and fixed activation recipes. The shipping activation helper was executed successfully on Flautist with six plugins and both verified archives. Manifest changes invalidate plans. The local collector uses a working system Python interpreter and validates its host identity. Local helper execution clears inherited Python and library overrides so the dashboard does not select the broken user runtime. Manifest deployments retain unrelated user skills, extra profiles, target scalar settings, and official/native integrations. The final live preview reached all three Linux targets, proposed zero classified changes, and verified all 15 approved Linux plugin installations. It retained host-specific/unclassified settings as review items rather than copying them.

Private evidence is in `.dashboard-state/fleet-20261014/`; private inventory and deployment inputs are in `config/fleet.local.json` and `config/deployment.local.json`. Source and build archives are under the user's `build/codex-fleet-sync/` directory. Those locations contain per-host before/after inventories, config hashes, revisions or source-tree hashes, artifact hashes, executable allowlists, effective MCP checks, activity/activation outcomes, and sudo fixture outcomes. Credentials and OAuth/session caches were never deployment inputs.

Validation completed:

- Dashboard: 60 Python tests plus seven subtests; 69 TypeScript/Vitest tests; four Node script tests; five browser tests. Lint, type checking, production build, and public-snapshot scan passed.
- Git BBQ Go tests and native build.
- Astra native build, 20 unit tests and five workflow tests.
- Long-running-task plugin: 84 tests passed from the complete source repository. Running repository-layout tests against the installed package initially failed; the complete-repository run resolved that validation error.
- Hugo native build and package tests, with one remaining contract-test failure described below.
- Fresh main/focused/sysadmin MCP initialization and tool discovery; Ubuntu read-only system information; native app CUA initialization where supplied by the installed app runtime.
- Checksums, executable modes, launcher paths, strict main config loading, CLI/daemon versions, approved plugin subsets, and profile sudo boundaries.

## Recovery and remaining adoption limits

Config replacements retain private source/target recovery copies, except the specifically excluded moltbuntu cua_repl cleanup. Installed legacy plugin artifacts were retained for recovery while their duplicate selectors were made inactive. Content-addressed source/build archives and staged-file inventories permit repeat-run verification. Interrupted staging does not adopt incomplete extraction; changed staged files are rejected. No active turn was interrupted for activation.

OpenAI Developer Docs and Cloudflare HTTP initialization need a successful network/authentication check from the intended runtime; 403 was observed here. No interactive authentication was attempted. Existing app/browser sessions were retained, and no content was published.

Maccauley's daemon idle state was unknown; dc2 had an active turn; moltbuntu lacked an enabled dashboard-managed service. Fresh invocations use the deployed configs, but existing sessions on those daemons are not counted as restarted adoption.

Hugo's `TestContractDiffPageErrorUsesStructuredEnvelope` fails because the fixture call succeeds where the test expects missing Git metadata. The rest of its package test run passed. The release builds and initializes successfully, but this upstream/source contract discrepancy remains unresolved and must not be treated as a fully passing native test suite.

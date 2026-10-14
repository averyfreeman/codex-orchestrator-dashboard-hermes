import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActionsAndView } from "./codex-sync";
import { deploymentPolicy } from "./deployment-policy";
vi.mock("./deployment-policy", async (original) => ({ ...await original<typeof import("./deployment-policy")>(), deploymentPolicy: vi.fn() }));
const host = { slug: "target", name: "Target", os: "Linux", localIp: null, tailscaleIp: null, zerotierIp: null, identity: { hostname: "target", system: "Linux", machine: "x86_64" } };
const plugin = { name: "git-bbq", marketplaceName: "source-release", marketplaceKind: "local", selector: "git-bbq@source-release", enabled: true, version: "0.4.0", transferBlocked: true };
function snapshot(plugins: unknown[], marketplace: string) {
  return { cliVersion: "0.162.1", runtimeVersion: "0.162.1", runtimeStatus: "running", activeTurns: { count: 0, known: true }, codexHome: { configured: true, label: "~/.codex", source: "default" }, config: { files: [], profileNames: [], hash: "config" }, plugins: { available: true, plugins, marketplaces: [{ name: marketplace, kind: "local" }], localPackages: {}, hash: "plugins" }, skills: { skills: {}, blocked: [], hash: "skills" }, snapshotHash: "snapshot", public: {} } as unknown as Parameters<typeof makeActionsAndView>[1];
}
beforeEach(() => {
  vi.mocked(deploymentPolicy).mockReturnValue({ cliVersion: "0.162.1", archive: "a".repeat(64), dependencyArchive: "b".repeat(64), excluded: ["git-bbq-dev"], packageHashes: { "git-bbq": "approved-content" }, hosts: { target: { plugins: ["git-bbq"], daisyui: false } } });
});
describe("native fleet planning", () => {
  it("adopts a native package only when its content and executable hash match", () => {
    const installed = { ...plugin, selector: "git-bbq@fleet-release", marketplaceName: "fleet-release", artifactHash: "approved-content" };
    const plan = makeActionsAndView(host, snapshot([plugin],"source-release"), snapshot([installed],"fleet-release"), true);
    expect(plan.actions.artifactStage).toBeUndefined();
    expect(plan.actions.plugins.add).toEqual([]);
    expect(plan.actions.plugins.remove).toEqual([]);
    expect(plan.view.diffs.some((item) => item.message?.includes("approved platform artifact"))).toBe(true);
  });
  it("stages fixed verified inputs when native content changed", () => {
    const installed = { ...plugin, selector: "git-bbq@fleet-release", marketplaceName: "fleet-release", artifactHash: "changed-content" };
    const plan = makeActionsAndView(host, snapshot([plugin],"source-release"), snapshot([installed],"fleet-release"), true);
    expect(plan.actions.artifactStage).toMatchObject({ plugins: ["git-bbq"], daisyui: false });
    expect(plan.actions.plugins.add).toEqual([]); // Never feed the Mac binary through JSON.
  });
});
it("keeps unrelated target settings and user skills outside a manifest deployment", () => {
  const source = snapshot([],"source-release");
  const target = snapshot([],"fleet-release");
  const file = { name: "config.toml", exists: true, hash: "hash", invalid: false, unclassified: {}, portable: { model: "gpt-6.1-sol" } };
  source.config.files = [file, { ...file, name: "unrelated.config.toml" }];
  target.config.files = [{ ...file, portable: { model: "gpt-6.1-sol", personality: "pragmatic" } }];
  target.skills.skills["agents/local-skill"] = { hash: "skill", files: {}, fileNames: ["SKILL.md"], fileHashes: { "SKILL.md": "content" } };
  const plan = makeActionsAndView(host,source,target,true);
  expect(plan.actions.config).toEqual([]);
  expect(plan.actions.skills.delete).toEqual([]);
  expect(plan.view.diffs.some((item) => item.message?.includes("User skills remain host-owned"))).toBe(true);
});

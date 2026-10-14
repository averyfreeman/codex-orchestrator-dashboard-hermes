import { describe, expect, it } from "vitest";
import { permitsPlugin, permitsSetting } from "./deployment-policy";
const policy = { cliVersion: "0.162.1", excluded: ["git-bbq-dev"], hosts: { limited: { plugins: ["git-bbq", "spit-roast", "long-running-tasks-plugin"], daisyui: false } } };
describe("private deployment matrix", () => {
  it("enforces the limited plugin subset and excludes preview", () => {
    expect(permitsPlugin(policy,"limited","git-bbq","fleet-release")).toBe(true);
    expect(permitsPlugin(policy,"limited","hugo-railway","fleet-release")).toBe(false);
    expect(permitsPlugin(policy,"limited","git-bbq-dev","preview")).toBe(false);
    expect(permitsPlugin(policy,"limited","browser","openai-bundled")).toBe(true);
  });
  it("excludes daisyUI in every profile variant", () => {
    expect(permitsSetting(policy,"limited","mcp_servers.daisyui-mcp.command")).toBe(false);
    expect(permitsSetting(policy,"limited","mcp_servers.fs-mcp.command")).toBe(true);
  });
});

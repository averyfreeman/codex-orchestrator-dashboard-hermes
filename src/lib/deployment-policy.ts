import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type Policy = { hostSettings?: Record<string, Record<string, Record<string, string>>>; archive?: string; artifactPath?: string; dependencyArchive?: string; dependencyArtifactPath?: string; packageHashes?: Record<string, string>; cliVersion: string; excluded: string[]; hosts: Record<string, { plugins: string[]; daisyui: boolean }> };

/** Private operator-owned capability matrix; never returned to browser clients. */
export function deploymentPolicy(): Policy | null {
  const file = process.env.FLEET_DEPLOYMENT_PATH ?? path.join(process.cwd(), "config/deployment.local.json");
  if (!existsSync(/*turbopackIgnore: true*/ file)) return null;
  const policy = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Policy;
  if (policy.cliVersion !== "0.162.1" || !Array.isArray(policy.excluded) || !policy.hosts) throw new Error("Invalid private fleet deployment manifest.");
  return policy;
}

export function permitsPlugin(policy: Policy | null, host: string, name: string, marketplace: string) {
  if (!policy) return true;
  if (policy.excluded.includes(name) || marketplace.includes("preview")) return false;
  if (marketplace.startsWith("openai-")) return true;
  return policy.hosts[host]?.plugins.includes(name) ?? false;
}

export function permitsSetting(policy: Policy | null, host: string, name: string) {
  if (policy?.hosts[host] && name.startsWith("mcp_servers.astra-watch.") && !policy.hosts[host].plugins.includes("astra-watch")) return false;
  return !(policy?.hosts[host]?.daisyui === false && /daisyui/i.test(name));
}

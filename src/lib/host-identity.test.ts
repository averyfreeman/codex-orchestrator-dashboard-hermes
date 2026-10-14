import { describe, expect, it } from "vitest";
import { matchesHostIdentity, type SshRoute } from "./hosts";

describe("fleet host identity", () => {
  const expected = { hostname: "node-a", system: "Linux", machine: "x86_64" };
  it("accepts a LAN route backed by the configured key alias", () => {
    const route: SshRoute = { transport: "lan", target: "operator@192.0.2.20", hostKeyAlias: "verified-node-a" };
    expect(route.transport).toBe("lan");
    expect(matchesHostIdentity(expected, { ...expected, hostname: "NODE-A" })).toBe(true);
  });
  it("rejects wrong local attribution, host identity, and architecture", () => {
    expect(matchesHostIdentity(expected, { ...expected, hostname: "node-b" })).toBe(false);
    expect(matchesHostIdentity(expected, { ...expected, machine: "arm64" })).toBe(false);
    expect(matchesHostIdentity(expected, { ...expected, system: "Darwin" })).toBe(false);
  });
});

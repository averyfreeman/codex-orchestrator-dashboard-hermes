import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sanitizeHostReport, unavailableReport, type HostDefinition } from "@/lib/hosts";
import { appendEvent, appendSnapshot, isLogEvent, MAX_LOG_EVENTS, readRecentEvents, retainRecentEventLines } from "@/lib/logging";

const nodeA: HostDefinition = {
  slug: "node-a",
  name: "Node A",
  os: "Linux",
  localIp: null,
  tailscaleIp: null,
  zerotierIp: null,
  sshRoutes: [
    { transport: "zerotier", target: "operator@node-a.example.test", hostKeyAlias: "fleet-node-a" },
    { transport: "tailscale", target: "operator@node-a.example.test", hostKeyAlias: "fleet-node-a" },
  ],
};

describe("fleet metadata", () => {
  it("keeps the first configured route as the preferred route", () => {
    expect(nodeA.sshRoutes?.map((route) => route.transport)).toEqual(["zerotier", "tailscale"]);
    expect(unavailableReport(nodeA).connection.transport).toBe("unavailable");
  });

  it("removes private SSH configuration and raw probe errors from browser reports", () => {
    const report = unavailableReport({ ...nodeA, codexHome: "/home/operator/.codex-private" });
    const sanitized = sanitizeHostReport({
      ...report,
      connection: { transport: "tailscale", target: "operator@192.0.2.1" },
      appServer: { ...report.appServer, error: "ssh stderr /home/operator/private-key" },
      herdr: { ...report.herdr, error: "token=secret" },
      error: "ssh stderr /home/operator/private-key",
    });

    expect(sanitized.host).not.toHaveProperty("sshRoutes");
    expect(sanitized.host).not.toHaveProperty("codexHome");
    expect(sanitized.connection.target).toBeNull();
    expect(sanitized.appServer.error).toBe("Probe reported an error.");
    expect(sanitized.herdr.error).toBe("Probe reported an error.");
    expect(sanitized.error).toBe("Probe reported an error.");
  });

  it("marks host resource measurements unknown when a probe is unavailable", () => {
    expect(unavailableReport(nodeA)).toHaveProperty("resources", null);
  });

  it("accepts bounded structured telemetry and rejects malformed events", () => {
    expect(isLogEvent({ source: "collector", host: "node-a", type: "snapshot", stats: { cpu: 2.1 } })).toBe(true);
    expect(isLogEvent({ source: "", host: "node-a", type: "snapshot" })).toBe(false);
    expect(isLogEvent({ source: "collector", host: "node-a", type: "snapshot", stats: [] })).toBe(false);
    expect(isLogEvent({ source: "collector", host: "node-a", type: "snapshot", stats: { details: { secret: "not a metric" } } })).toBe(false);
    expect(isLogEvent({ source: "collector", host: "node-a", type: "snapshot", stats: { cpu: "2.1" } })).toBe(false);
    expect(isLogEvent({ source: "collector", host: "node-a", type: "snapshot", at: "not-a-date" })).toBe(false);
    expect(isLogEvent({ source: "collector", host: "node-a", type: "snapshot", prompt: "must not persist" })).toBe(false);
    expect(isLogEvent(null)).toBe(false);
  });

  it("retains only valid events from the configured seven-day window and count bound", () => {
    const now = Date.parse("2026-10-13T12:00:00.000Z");
    const old = JSON.stringify({ at: "2026-10-06T11:59:59.999Z", source: "collector", host: "node-a", type: "snapshot" });
    const current = JSON.stringify({ at: "2026-10-13T11:59:00.000Z", source: "collector", host: "node-a", type: "snapshot" });
    const future = JSON.stringify({ at: "2026-10-14T12:00:00.000Z", source: "collector", host: "node-a", type: "snapshot" });
    const events = Array.from({ length: MAX_LOG_EVENTS + 1 }, (_, index) => JSON.stringify({ at: new Date(now - index).toISOString(), source: "collector", host: "node-a", type: "snapshot" }));

    expect(retainRecentEventLines([old, "not json", future, current], now)).toEqual([current]);
    expect(retainRecentEventLines(events, now)).toHaveLength(MAX_LOG_EVENTS);

    const largeEvents = Array.from({ length: MAX_LOG_EVENTS }, (_, index) => JSON.stringify({
      at: new Date(now - index).toISOString(),
      source: "collector",
      host: "node-a",
      type: "snapshot",
      filler: "x".repeat(1_200),
    }));
    const bounded = retainRecentEventLines(largeEvents, now);
    expect(bounded.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0)).toBeLessThanOrEqual(1_000_000);
  });

  it("serializes bounded file-backed events and physically removes expired records", async () => {
    const originalCwd = process.cwd();
    const directory = await mkdtemp(path.join(os.tmpdir(), "dashboard-logs-"));
    try {
      process.chdir(directory);
      await Promise.all(Array.from({ length: 10 }, (_, index) => appendEvent({
        source: "test",
        host: "node-a",
        type: `metric.${index}`,
        stats: { count: index },
      })));
      expect(await readRecentEvents(20)).toHaveLength(10);

      const logFile = path.join(directory, "logs", "events.jsonl");
      expect((await stat(path.join(directory, "logs"))).mode & 0o777).toBe(0o700);
      expect((await stat(logFile)).mode & 0o777).toBe(0o600);
      await mkdir(path.dirname(logFile), { recursive: true });
      await writeFile(logFile, `${JSON.stringify({ at: "2026-10-06T11:59:59.999Z", source: "test", host: "node-a", type: "old" })}\n`);

      expect(await readRecentEvents()).toEqual([]);
      expect(await readFile(logFile, "utf8")).toBe("");
    } finally {
      process.chdir(originalCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists collected host resource metrics as flat numeric events", async () => {
    const originalCwd = process.cwd();
    const directory = await mkdtemp(path.join(os.tmpdir(), "dashboard-resource-logs-"));
    try {
      process.chdir(directory);
      const report = {
        ...unavailableReport(nodeA),
        resources: {
          cpuPercent: 49.9,
          cpuCount: 4,
          load1: 2.5,
          memoryPercent: 75,
          memoryTotalMb: 4,
          memoryAvailableMb: 1,
          diskPercent: 75,
          diskTotalGb: 100,
          diskFreeGb: 25,
        },
      };

      await appendSnapshot([report]);

      const metricsEvent = (await readRecentEvents()).find((event) => event.type === "resource_metrics");
      expect(metricsEvent).toMatchObject({
        source: "dashboard",
        host: "node-a",
        stats: {
          cpuPercent: 49.9,
          cpuCount: 4,
          load1: 2.5,
          memoryPercent: 75,
          memoryTotalMb: 4,
          memoryAvailableMb: 1,
          diskPercent: 75,
          diskTotalGb: 100,
          diskFreeGb: 25,
        },
      });
      expect(isLogEvent(metricsEvent)).toBe(true);
    } finally {
      process.chdir(originalCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

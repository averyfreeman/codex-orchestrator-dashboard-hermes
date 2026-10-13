import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { appendSnapshotMock, collectOverviewMock, connectionMock } = vi.hoisted(() => ({
  appendSnapshotMock: vi.fn(),
  collectOverviewMock: vi.fn(),
  connectionMock: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: connectionMock };
});
vi.mock("@/lib/collector", () => ({ collectOverview: collectOverviewMock }));
vi.mock("@/lib/logging", () => ({ appendSnapshot: appendSnapshotMock }));

import { GET } from "./route";

const originalThresholds = {
  cpu: process.env.DASHBOARD_CPU_WARN_PERCENT,
  cpuSeconds: process.env.DASHBOARD_CPU_WARN_SUSTAINED_SECONDS,
  memory: process.env.DASHBOARD_MEMORY_WARN_PERCENT,
  disk: process.env.DASHBOARD_DISK_WARN_PERCENT,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("GET /api/overview resource thresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMock.mockResolvedValue(undefined);
    collectOverviewMock.mockResolvedValue([]);
    appendSnapshotMock.mockResolvedValue(undefined);
    process.env.DASHBOARD_CPU_WARN_PERCENT = "70";
    process.env.DASHBOARD_CPU_WARN_SUSTAINED_SECONDS = "45";
    delete process.env.DASHBOARD_MEMORY_WARN_PERCENT;
    delete process.env.DASHBOARD_DISK_WARN_PERCENT;
  });

  afterEach(() => {
    restore("DASHBOARD_CPU_WARN_PERCENT", originalThresholds.cpu);
    restore("DASHBOARD_CPU_WARN_SUSTAINED_SECONDS", originalThresholds.cpuSeconds);
    restore("DASHBOARD_MEMORY_WARN_PERCENT", originalThresholds.memory);
    restore("DASHBOARD_DISK_WARN_PERCENT", originalThresholds.disk);
  });

  it("returns server-resolved thresholds alongside the private fleet report", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      hosts: [],
      resourceThresholds: {
        cpuPercent: 70,
        cpuSustainedSeconds: 45,
        memoryPercent: 80,
        diskPercent: 80,
      },
    });
    expect(appendSnapshotMock).toHaveBeenCalledWith([]);
  });
});

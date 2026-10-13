import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOURCE_THRESHOLDS,
  evaluateResourceWarnings,
  normalizeResourceMetrics,
  readResourceThresholds,
  type ResourceMetrics,
} from "@/lib/resource-metrics";

const sample: ResourceMetrics = {
  cpuPercent: 78,
  cpuCount: 8,
  load1: 1.2,
  memoryPercent: 82,
  memoryTotalMb: 16_384,
  memoryAvailableMb: 2_949,
  diskPercent: 81,
  diskTotalGb: 512,
  diskFreeGb: 97,
};

const thresholds = {
  cpuPercent: 75,
  cpuSustainedSeconds: 60,
  memoryPercent: 80,
  diskPercent: 80,
};

describe("host resource thresholds and warnings", () => {
  it("keeps only finite, bounded numeric resource fields from remote probes", () => {
    expect(normalizeResourceMetrics({
      cpuPercent: 55,
      cpuCount: 8,
      load1: 2.5,
      memoryPercent: 120,
      memoryTotalMb: 16_384,
      memoryAvailableMb: -1,
      diskPercent: 74,
      diskTotalGb: 512,
      diskFreeGb: 99,
      privatePath: "/home/operator",
    })).toEqual({
      cpuPercent: 55,
      cpuCount: 8,
      load1: 2.5,
      memoryPercent: null,
      memoryTotalMb: 16_384,
      memoryAvailableMb: null,
      diskPercent: 74,
      diskTotalGb: 512,
      diskFreeGb: 99,
    });
    const inconsistent = normalizeResourceMetrics({
      ...sample,
      memoryAvailableMb: 20_000,
      diskFreeGb: 600,
    });
    expect(inconsistent?.memoryAvailableMb).toBeNull();
    expect(inconsistent?.diskFreeGb).toBeNull();
    expect(normalizeResourceMetrics({ privatePath: "/home/operator" })).toBeNull();
  });

  it("reads bounded configurable thresholds with safe defaults", () => {
    expect(readResourceThresholds({
      DASHBOARD_CPU_WARN_PERCENT: "70",
      DASHBOARD_CPU_WARN_SUSTAINED_SECONDS: "90",
      DASHBOARD_MEMORY_WARN_PERCENT: "85",
      DASHBOARD_DISK_WARN_PERCENT: "88",
    })).toEqual({ cpuPercent: 70, cpuSustainedSeconds: 90, memoryPercent: 85, diskPercent: 88 });
    expect(readResourceThresholds({ DASHBOARD_CPU_WARN_PERCENT: "999", DASHBOARD_MEMORY_WARN_PERCENT: "NaN" }))
      .toEqual(DEFAULT_RESOURCE_THRESHOLDS);
  });

  it("warns immediately for memory and disk but waits for sustained CPU pressure", () => {
    const first = evaluateResourceWarnings(sample, thresholds, null, 0);
    expect(first.warnings).toEqual([
      "Memory 82% used (threshold 80%).",
      "Home-volume disk 81% used (threshold 80%).",
    ]);
    const second = evaluateResourceWarnings(sample, thresholds, first.state, 30_000);
    expect(second.warnings).toEqual(first.warnings);
    const sustained = evaluateResourceWarnings(sample, thresholds, second.state, 60_000);
    expect(sustained.warnings).toEqual([
      "CPU 78% has remained at or above 75% for at least 60 seconds.",
      ...first.warnings,
    ]);
  });

  it("resets the CPU timer after a long sampling gap or a low sample", () => {
    const first = evaluateResourceWarnings(sample, thresholds, null, 0);
    const gap = evaluateResourceWarnings(sample, thresholds, first.state, 90_000);
    expect(gap.warnings).not.toContain("CPU 78% has remained at or above 75% for at least 60 seconds.");
    const low = evaluateResourceWarnings({ ...sample, cpuPercent: 20 }, thresholds, gap.state, 120_000);
    const highAgain = evaluateResourceWarnings(sample, thresholds, low.state, 150_000);
    expect(highAgain.warnings).not.toContain("CPU 78% has remained at or above 75% for at least 60 seconds.");
  });

  it("drops warnings and sustained state when a host metric is unavailable", () => {
    const first = evaluateResourceWarnings(sample, thresholds, null, 0);
    const unavailable = evaluateResourceWarnings(null, thresholds, first.state, 30_000);
    expect(unavailable.warnings).toEqual([]);
    expect(unavailable.state.cpuHighSinceMs).toBeNull();
  });
});

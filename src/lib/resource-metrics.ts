export type ResourceMetrics = {
  cpuPercent: number | null;
  cpuCount: number | null;
  load1: number | null;
  memoryPercent: number | null;
  memoryTotalMb: number | null;
  memoryAvailableMb: number | null;
  diskPercent: number | null;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
};

export type ResourceThresholds = {
  cpuPercent: number;
  cpuSustainedSeconds: number;
  memoryPercent: number;
  diskPercent: number;
};

export type ResourceSampleState = {
  cpuHighSinceMs: number | null;
  sampledAtMs: number;
};

export const DEFAULT_RESOURCE_THRESHOLDS: Readonly<ResourceThresholds> = {
  cpuPercent: 75,
  cpuSustainedSeconds: 60,
  memoryPercent: 80,
  diskPercent: 80,
};

const MAX_RESOURCE_SAMPLE_GAP_MS = 60_000;

function boundedMetric(value: unknown, min: number, max: number, integer = false): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    return null;
  }
  return value;
}

/** Project remote probe output onto the numeric resource schema only. */
export function normalizeResourceMetrics(value: unknown): ResourceMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const metrics: ResourceMetrics = {
    cpuPercent: boundedMetric(raw.cpuPercent, 0, 100),
    cpuCount: boundedMetric(raw.cpuCount, 1, 65_536, true),
    load1: boundedMetric(raw.load1, 0, Number.MAX_SAFE_INTEGER),
    memoryPercent: boundedMetric(raw.memoryPercent, 0, 100),
    memoryTotalMb: boundedMetric(raw.memoryTotalMb, 0, Number.MAX_SAFE_INTEGER),
    memoryAvailableMb: boundedMetric(raw.memoryAvailableMb, 0, Number.MAX_SAFE_INTEGER),
    diskPercent: boundedMetric(raw.diskPercent, 0, 100),
    diskTotalGb: boundedMetric(raw.diskTotalGb, 0, Number.MAX_SAFE_INTEGER),
    diskFreeGb: boundedMetric(raw.diskFreeGb, 0, Number.MAX_SAFE_INTEGER),
  };
  if (metrics.memoryTotalMb !== null && metrics.memoryAvailableMb !== null && metrics.memoryAvailableMb > metrics.memoryTotalMb) {
    metrics.memoryAvailableMb = null;
  }
  if (metrics.diskTotalGb !== null && metrics.diskFreeGb !== null && metrics.diskFreeGb > metrics.diskTotalGb) {
    metrics.diskFreeGb = null;
  }
  return Object.values(metrics).some((metric) => metric !== null) ? metrics : null;
}

function readBoundedNumber(value: string | undefined, fallback: number, min: number, max: number, integer = false) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) return fallback;
  return parsed;
}

/** Read optional server-side warning thresholds; invalid values use safe defaults. */
export function readResourceThresholds(env: Readonly<Record<string, string | undefined>>): ResourceThresholds {
  return {
    cpuPercent: readBoundedNumber(env.DASHBOARD_CPU_WARN_PERCENT, DEFAULT_RESOURCE_THRESHOLDS.cpuPercent, 1, 100),
    cpuSustainedSeconds: readBoundedNumber(env.DASHBOARD_CPU_WARN_SUSTAINED_SECONDS, DEFAULT_RESOURCE_THRESHOLDS.cpuSustainedSeconds, 1, 3600, true),
    memoryPercent: readBoundedNumber(env.DASHBOARD_MEMORY_WARN_PERCENT, DEFAULT_RESOURCE_THRESHOLDS.memoryPercent, 1, 100),
    diskPercent: readBoundedNumber(env.DASHBOARD_DISK_WARN_PERCENT, DEFAULT_RESOURCE_THRESHOLDS.diskPercent, 1, 100),
  };
}

function percent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Evaluate warning levels without claiming CPU pressure from a single sample. */
export function evaluateResourceWarnings(
  metrics: ResourceMetrics | null,
  thresholds: ResourceThresholds,
  previous: ResourceSampleState | null,
  sampledAtMs: number,
): { state: ResourceSampleState; warnings: string[] } {
  if (!metrics) return { state: { cpuHighSinceMs: null, sampledAtMs }, warnings: [] };

  const prior = previous && Number.isFinite(previous.sampledAtMs) ? previous : null;
  const isNewSample = !prior || sampledAtMs > prior.sampledAtMs;
  const sampleGap = prior && isNewSample ? sampledAtMs - prior.sampledAtMs : 0;
  const cpuPercent = percent(metrics.cpuPercent);
  let cpuHighSinceMs = prior?.cpuHighSinceMs ?? null;
  if (!isNewSample) {
    cpuHighSinceMs = prior?.cpuHighSinceMs ?? null;
  } else if (cpuPercent === null || cpuPercent < thresholds.cpuPercent) {
    cpuHighSinceMs = null;
  } else if (!prior || prior.cpuHighSinceMs === null || sampleGap > MAX_RESOURCE_SAMPLE_GAP_MS) {
    cpuHighSinceMs = sampledAtMs;
  }

  const warnings: string[] = [];
  if (cpuPercent !== null && cpuHighSinceMs !== null &&
    sampledAtMs - cpuHighSinceMs >= thresholds.cpuSustainedSeconds * 1000) {
    warnings.push(`CPU ${Math.round(cpuPercent)}% has remained at or above ${thresholds.cpuPercent}% for at least ${thresholds.cpuSustainedSeconds} seconds.`);
  }
  const memoryPercent = percent(metrics.memoryPercent);
  if (memoryPercent !== null && memoryPercent >= thresholds.memoryPercent) {
    warnings.push(`Memory ${Math.round(memoryPercent)}% used (threshold ${thresholds.memoryPercent}%).`);
  }
  const diskPercent = percent(metrics.diskPercent);
  if (diskPercent !== null && diskPercent >= thresholds.diskPercent) {
    warnings.push(`Home-volume disk ${Math.round(diskPercent)}% used (threshold ${thresholds.diskPercent}%).`);
  }

  return {
    state: {
      cpuHighSinceMs,
      sampledAtMs: isNewSample ? sampledAtMs : prior?.sampledAtMs ?? sampledAtMs,
    },
    warnings,
  };
}

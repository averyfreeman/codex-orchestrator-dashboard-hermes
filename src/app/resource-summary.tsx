import styles from "./resource-summary.module.css";
import type { ResourceMetrics } from "@/lib/resource-metrics";

type Props = {
  metrics: ResourceMetrics | null;
  warnings: string[];
};

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "Unknown" : `${Number(value.toFixed(1))}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatMemory(value: number | null) {
  if (value === null) return "Unknown";
  return value >= 1024 ? `${formatNumber(value / 1024)} GB` : `${formatNumber(value)} MB`;
}

function formatDisk(value: number | null) {
  return value === null ? "Unknown" : `${formatNumber(value)} GB`;
}

export function ResourceSummary({ metrics, warnings }: Props) {
  const cpuDetails = metrics?.cpuCount !== null && metrics?.cpuCount !== undefined && metrics?.load1 !== null && metrics?.load1 !== undefined
    ? `${metrics.cpuCount} cores · 1m load ${formatNumber(metrics.load1)}`
    : "Unknown";
  const memoryDetails = metrics?.memoryAvailableMb !== null && metrics?.memoryAvailableMb !== undefined && metrics?.memoryTotalMb !== null && metrics?.memoryTotalMb !== undefined
    ? `${formatMemory(metrics.memoryAvailableMb)} available of ${formatMemory(metrics.memoryTotalMb)}`
    : "Unknown";
  const diskDetails = metrics?.diskFreeGb !== null && metrics?.diskFreeGb !== undefined && metrics?.diskTotalGb !== null && metrics?.diskTotalGb !== undefined
    ? `${formatDisk(metrics.diskFreeGb)} free of ${formatDisk(metrics.diskTotalGb)}`
    : "Unknown";

  return (
    <section className={styles.summary} aria-label="Host resource summary">
      <div className={styles.grid}>
        <div className={styles.metric}>
          <span className={styles.label}>CPU</span>
          <strong>{formatPercent(metrics?.cpuPercent)}</strong>
          <small>{cpuDetails}</small>
        </div>
        <div className={styles.metric}>
          <span className={styles.label}>MEMORY</span>
          <strong>{formatPercent(metrics?.memoryPercent)}</strong>
          <small>{memoryDetails}</small>
        </div>
        <div className={styles.metric}>
          <span className={styles.label}>HOME-VOLUME DISK</span>
          <strong>{formatPercent(metrics?.diskPercent)}</strong>
          <small>{diskDetails}</small>
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className={styles.warnings} aria-label="Resource warnings" role="status" aria-live="polite">
          {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}

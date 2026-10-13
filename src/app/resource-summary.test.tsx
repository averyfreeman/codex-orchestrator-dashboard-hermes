import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourceSummary } from "@/app/resource-summary";
import type { ResourceMetrics } from "@/lib/resource-metrics";

const metrics: ResourceMetrics = {
  cpuPercent: 87.5,
  cpuCount: 8,
  load1: 1.2,
  memoryPercent: 82,
  memoryTotalMb: 16_384,
  memoryAvailableMb: 3_072,
  diskPercent: 79.4,
  diskTotalGb: 512,
  diskFreeGb: 97,
};

describe("resource summary", () => {
  it("shows CPU, memory, home-volume disk capacity, and resource warnings", () => {
    const markup = renderToStaticMarkup(<ResourceSummary
      metrics={metrics}
      warnings={["CPU 88% has remained at or above 75% for at least 60 seconds."]}
    />);

    expect(markup).toContain("CPU");
    expect(markup).toContain("87.5%");
    expect(markup).toContain("8 cores · 1m load 1.2");
    expect(markup).toContain("82%");
    expect(markup).toContain("3 GB available of 16 GB");
    expect(markup).toContain("79.4%");
    expect(markup).toContain("97 GB free of 512 GB");
    expect(markup).toContain("CPU 88% has remained at or above 75% for at least 60 seconds.");
  });

  it("labels unavailable measurements as unknown instead of zero", () => {
    const markup = renderToStaticMarkup(<ResourceSummary metrics={null} warnings={[]} />);

    expect(markup.match(/Unknown/g)).toHaveLength(6);
    expect(markup).not.toContain("0%");
  });
});

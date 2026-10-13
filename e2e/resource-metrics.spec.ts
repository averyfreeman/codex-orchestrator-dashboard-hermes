import { expect, test } from "@playwright/test";

const reports = [
  {
    host: { slug: "node-a", name: "Online test host", os: "Linux", localIp: null, tailscaleIp: null, zerotierIp: null },
    checkedAt: "2026-10-13T12:00:00.000Z",
    reachable: true,
    connection: { transport: "local", target: null },
    appServer: { status: "running", cliVersion: "0.1.0", version: "1", remoteControlEnabled: true, remoteControlRuntime: "running", loadedThreads: 1, startup: "enabled", error: null },
    herdr: { status: "unavailable", version: null, startup: "unknown", agents: [], workspaces: [], error: null },
    processes: [],
    resources: {
      cpuPercent: 92,
      cpuCount: 8,
      load1: 2.5,
      memoryPercent: 95,
      memoryTotalMb: 16_384,
      memoryAvailableMb: 819,
      diskPercent: 92,
      diskTotalGb: 100,
      diskFreeGb: 8,
    },
    worktrees: [],
    error: null,
  },
  {
    host: { slug: "node-b", name: "Unknown test host", os: "Linux", localIp: null, tailscaleIp: null, zerotierIp: null },
    checkedAt: "2026-10-13T12:00:00.000Z",
    reachable: false,
    connection: { transport: "unavailable", target: null },
    appServer: { status: "unavailable", cliVersion: null, version: null, remoteControlEnabled: null, remoteControlRuntime: "unavailable", loadedThreads: null, startup: "unknown", error: null },
    herdr: { status: "unavailable", version: null, startup: "unknown", agents: [], workspaces: [], error: null },
    processes: [],
    resources: null,
    worktrees: [],
    error: null,
  },
];

test("renders host metrics and immediate resource warnings without treating one CPU sample as sustained", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/overview", (route) => route.fulfill({
    json: {
      checkedAt: new Date().toISOString(),
      resourceThresholds: { cpuPercent: 75, cpuSustainedSeconds: 60, memoryPercent: 80, diskPercent: 80 },
      hosts: reports,
    },
  }));
  await page.route("**/api/logs", (route) => route.fulfill({ json: { events: [] } }));

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "App-server fleet" })).toBeVisible();
  const summaries = page.getByRole("region", { name: "Host resource summary" });
  await expect(summaries).toHaveCount(2);
  const online = summaries.nth(0);
  await expect(online.getByText("92%", { exact: true })).toHaveCount(2);
  await expect(online.getByText("8 cores · 1m load 2.5")).toBeVisible();
  await expect(online.getByText("819 MB available of 16 GB")).toBeVisible();
  await expect(online.getByText("8 GB free of 100 GB")).toBeVisible();
  const warnings = online.getByRole("status", { name: "Resource warnings" });
  await expect(warnings).toContainText("Memory 95% used (threshold 80%).");
  await expect(warnings).toContainText("Home-volume disk 92% used (threshold 80%).");
  await expect(warnings).not.toContainText("CPU");

  const unknown = summaries.nth(1);
  await expect(unknown.getByText("Unknown", { exact: true })).toHaveCount(6);
  await expect(unknown.getByRole("status", { name: "Resource warnings" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
